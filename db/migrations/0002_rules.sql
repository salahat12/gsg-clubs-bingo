-- =====================================================================
-- 0002_rules.sql — the game rules engine.
--
-- Everything that decides a game outcome lives here, as SECURITY DEFINER
-- functions, so each one is a single atomic transaction. This matters at
-- 300 concurrent players: two people confirming into the same square, or
-- two lines completing at once, are real races — not hypotheticals.
--
-- Error codes (SQLSTATE) map to user-facing copy in src/lib/errors.ts:
--   GB100 not started   GB101 paused        GB102 ended      GB103 countdown
--   GB104 join closed   GB200 rate limited  GB300 self-match
--   GB301 pair cap      GB302 same university (criterion 4)
--   GB304 square filled
--   GB305 not yours     GB306 already answered  GB307 ambiguous code
--   GB400 player gone   GB401 not found     GB402 bad card state
--   GB403 bad request
-- The RAISE message is the copy shown to the player, so it is written in
-- plain, active language, not as a developer log line.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The start gate. Every gameplay write calls this first. Note it rejects
-- during the 3-2-1 countdown too: status is already 'running' so clients
-- can render the countdown, but now() < started_at means nobody can act.
-- ---------------------------------------------------------------------
create or replace function assert_playable(p_event_id uuid)
returns void language plpgsql stable as $$
declare e events%rowtype;
begin
  select * into e from events where id = p_event_id;
  if not found then
    raise exception 'That event does not exist.' using errcode = 'GB401';
  end if;
  if e.status = 'waiting' then
    raise exception 'The game has not started yet. Hang tight in the lobby.' using errcode = 'GB100';
  end if;
  if e.status = 'paused' then
    raise exception 'The game is paused. It will resume shortly.' using errcode = 'GB101';
  end if;
  if e.status = 'ended' then
    raise exception 'The game has ended.' using errcode = 'GB102';
  end if;
  if e.started_at is null or now() < e.started_at then
    raise exception 'Almost there — the countdown is still running.' using errcode = 'GB103';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Returns a live player row, or raises. Used by every player-facing RPC
-- so that admin-removing a player revokes their token instantly.
-- ---------------------------------------------------------------------
create or replace function get_live_player(p_player_id uuid)
returns players language plpgsql stable as $$
declare p players%rowtype;
begin
  select * into p from players where id = p_player_id;
  if not found or p.removed_at is not null then
    raise exception 'Your player record is no longer active. Join again to get a new card.'
      using errcode = 'GB400';
  end if;
  return p;
end $$;

-- ---------------------------------------------------------------------
-- Per-player rate limiting. The GC is probabilistic so the common path
-- stays two index lookups rather than a table scan.
-- ---------------------------------------------------------------------
create or replace function assert_rate(
  p_player_id uuid, p_kind text, p_limit int, p_window interval
) returns void language plpgsql as $$
declare n int;
begin
  if random() < 0.02 then
    delete from rate_events where created_at < now() - interval '15 minutes';
  end if;

  select count(*) into n
  from rate_events
  where player_id = p_player_id and kind = p_kind and created_at > now() - p_window;

  if n >= p_limit then
    raise exception 'You are doing that too fast. Wait a few seconds and try again.'
      using errcode = 'GB200';
  end if;

  insert into rate_events(player_id, kind) values (p_player_id, p_kind);
end $$;

-- ---------------------------------------------------------------------
-- A player's display university: the label off the lookup table, or
-- their own free text when they picked 'other'. Used for messages and
-- for every read model that shows "university" — never stored on
-- `players` itself, so relabeling `universities` updates every live
-- display at once. (The one deliberate exception is card_squares'
-- filled_by_university, which freezes a snapshot at fill time.)
-- ---------------------------------------------------------------------
create or replace function university_label(p_player_id uuid)
returns text language sql stable as $$
  select case when p.university_value = 'other' then p.university_other_text else u.label end
  from players p left join universities u on u.value = p.university_value
  where p.id = p_player_id
$$;

-- ---------------------------------------------------------------------
-- Machine-checkable criteria. p_subject is the player whose square would
-- be filled; p_other is the person who was scanned.
--
-- diff_university compares university_group, not university_value — this
-- is the one column relabeling can never change the meaning of.
--
-- Criterion 7 ("was in the previous scholarship") is NOT checked here —
-- every attendee is the same 2025-2026 cohort, so there's no player fact
-- to verify. It stays 'honor', taken on faith like the other 23.
-- ---------------------------------------------------------------------
create or replace function assert_criterion_rule(
  p_criterion_id uuid, p_subject uuid, p_other uuid
) returns void language plpgsql stable as $$
declare
  c criteria%rowtype;
  a players%rowtype;
  b players%rowtype;
begin
  select * into c from criteria where id = p_criterion_id;
  if not found then
    raise exception 'That square is no longer part of the game.' using errcode = 'GB401';
  end if;
  if c.rule = 'honor' then return; end if;

  select * into a from players where id = p_subject;
  select * into b from players where id = p_other;

  if c.rule = 'diff_university' then
    if a.university_group = b.university_group then
      raise exception 'You are both from %. This square needs someone from a different university.',
        university_label(a.id) using errcode = 'GB302';
    end if;
  end if;
end $$;

-- Rate limit on the scan-resolve/preview path — hygiene at this scale,
-- reusing the same windowed-count mechanism as posts and replies.
create or replace function rpc_assert_scan_resolve_rate(p_player_id uuid)
returns void language plpgsql as $$
begin
  perform assert_rate(p_player_id, 'scan_resolve', 10, interval '1 minute');
end $$;

-- ---------------------------------------------------------------------
-- Line detection. Single source of truth for what "a line" means, used
-- both to award BINGOs and to withdraw them when an admin undoes a
-- square. Grid is idx 0..24, row = idx/5, col = idx%5.
-- ---------------------------------------------------------------------
create or replace function complete_lines(p_card_id uuid)
returns text[] language plpgsql stable as $$
declare
  m     boolean[];
  lines text[] := '{}';
  i int; j int; ok boolean;
begin
  select array_agg(s.status = 'filled' order by s.idx) into m
  from card_squares s where s.card_id = p_card_id;

  if m is null or array_length(m, 1) <> 25 then
    return '{}';
  end if;

  for i in 0..4 loop                                    -- rows
    ok := true;
    for j in 0..4 loop
      if not m[i * 5 + j + 1] then ok := false; exit; end if;
    end loop;
    if ok then lines := lines || ('row:' || i)::text; end if;
  end loop;

  for j in 0..4 loop                                    -- columns
    ok := true;
    for i in 0..4 loop
      if not m[i * 5 + j + 1] then ok := false; exit; end if;
    end loop;
    if ok then lines := lines || ('col:' || j)::text; end if;
  end loop;

  ok := true;                                           -- diag 0: 0,6,12,18,24
  for i in 0..4 loop
    if not m[i * 5 + i + 1] then ok := false; exit; end if;
  end loop;
  if ok then lines := lines || 'diag:0'::text; end if;

  ok := true;                                           -- diag 1: 4,8,12,16,20
  for i in 0..4 loop
    if not m[i * 5 + (4 - i) + 1] then ok := false; exit; end if;
  end loop;
  if ok then lines := lines || 'diag:1'::text; end if;

  return lines;
end $$;

-- ---------------------------------------------------------------------
-- Award any newly-completed lines and return only the NEW ones, so the
-- caller knows whether to fire the celebration. elapsed_ms is frozen at
-- insert time (minus accumulated pause) — a later pause cannot rewrite
-- someone's score.
-- ---------------------------------------------------------------------
create or replace function record_bingos(p_player_id uuid)
returns text[] language plpgsql as $$
declare
  v_card_id  uuid;
  v_event_id uuid;
  v_lines    text[];
  v_new      text[];
  v_elapsed  bigint;
begin
  select c.id, c.event_id into v_card_id, v_event_id from cards c where c.player_id = p_player_id;
  if v_card_id is null then return '{}'; end if;

  v_lines := complete_lines(v_card_id);
  if array_length(v_lines, 1) is null then return '{}'; end if;

  select greatest(0, (extract(epoch from (now() - e.started_at)) * 1000)::bigint - e.paused_ms)
    into v_elapsed
  from events e where e.id = v_event_id;

  with ins as (
    insert into bingos (event_id, player_id, line_key, elapsed_ms)
    select v_event_id, p_player_id, k, v_elapsed from unnest(v_lines) as t(k)
    on conflict (event_id, player_id, line_key) do nothing
    returning line_key
  )
  select coalesce(array_agg(line_key), '{}') into v_new from ins;

  return v_new;
end $$;

-- Withdraw BINGOs whose line is no longer complete (admin undo).
create or replace function recompute_bingos(p_player_id uuid)
returns void language plpgsql as $$
declare v_card_id uuid; v_lines text[];
begin
  select c.id into v_card_id from cards c where c.player_id = p_player_id;
  if v_card_id is null then return; end if;
  v_lines := complete_lines(v_card_id);
  delete from bingos b where b.player_id = p_player_id and not (b.line_key = any(v_lines));
end $$;

-- ---------------------------------------------------------------------
-- Pair budget. Unordered pair, counts both directions, capped by a CHECK
-- on the table so even a bug here cannot exceed it.
-- ---------------------------------------------------------------------
create or replace function pair_used(p_event_id uuid, p_a uuid, p_b uuid)
returns int language plpgsql as $$
declare v int;
begin
  insert into pair_matches (event_id, player_lo, player_hi, matched_count)
  values (p_event_id, least(p_a, p_b), greatest(p_a, p_b), 0)
  on conflict (event_id, player_lo, player_hi) do nothing;

  select matched_count into v from pair_matches
  where event_id = p_event_id and player_lo = least(p_a, p_b) and player_hi = greatest(p_a, p_b)
  for update;

  return v;
end $$;

create or replace function pair_consume(p_event_id uuid, p_a uuid, p_b uuid, p_n int)
returns void language plpgsql as $$
begin
  update pair_matches set matched_count = matched_count + p_n
  where event_id = p_event_id and player_lo = least(p_a, p_b) and player_hi = greatest(p_a, p_b);
end $$;
