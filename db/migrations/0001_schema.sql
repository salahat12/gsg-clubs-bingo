-- =====================================================================
-- 0001_schema.sql — DataCamp Scholarship Networking Bingo
-- Tables + constraints. Every game rule that CAN be expressed as a
-- database constraint IS one; the app is not the last line of defence.
-- =====================================================================

-- Supabase ships these roles. Locally (PGlite/plain Postgres) we create
-- them so the RLS migration and its tests run identically in both places.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- events
-- `started_at` is the race clock origin AND the start gate. Setting it a
-- few seconds in the future IS the 3-2-1 countdown: status flips to
-- 'running' immediately so clients can render the countdown, but every
-- gameplay write stays rejected until now() >= started_at. One source of
-- truth, no scheduled job.
-- ---------------------------------------------------------------------
create table events (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  status            text not null default 'waiting'
                      check (status in ('waiting','running','paused','ended')),
  started_at        timestamptz,
  ended_at          timestamptz,
  paused_at         timestamptz,
  paused_ms         bigint not null default 0 check (paused_ms >= 0),
  join_open         boolean not null default true,
  countdown_seconds int not null default 3 check (countdown_seconds between 0 and 30),
  created_at        timestamptz not null default now(),
  -- once the event leaves 'waiting' it must have a clock origin
  constraint events_clock_origin check (status = 'waiting' or started_at is not null)
);

-- ---------------------------------------------------------------------
-- criteria — the fixed 25 for the event.
-- `rule` drives server-side validation on a scan-fill:
--   honor           : between the two people, no server check
--   diff_university : criterion 4 — university_group must differ
-- Criterion 7 ("was in the previous scholarship") is deliberately left as
-- 'honor' — every attendee here is the same 2025-2026 cohort, so there is
-- no player fact to check server-side; it's taken on faith like the rest.
-- ---------------------------------------------------------------------
create table criteria (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  position   int  not null check (position between 1 and 25),
  text       text not null check (length(btrim(text)) between 1 and 300),
  rule       text not null default 'honor'
               check (rule in ('honor','diff_university')),
  active     boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (event_id, position)
);

-- ---------------------------------------------------------------------
-- universities — a fixed lookup, not free text. Free text broke matching
-- last time ("An-Najah" vs "Najah University" read as different places).
-- Stable `value` is what's stored on a player and compared for matching;
-- `label` is display-only and can be reworded without touching a single
-- match. `group_key` is what criterion 4 actually compares: normally the
-- same as `value`, except where two values are genuinely one institution
-- for matching purposes — a `university_group` column rather than a
-- hardcoded condition, so a future split campus works the same way.
-- The 'other' row exists so the FK below is always satisfiable; its
-- group_key is never read — rpc_join assigns each Other player their own
-- unique group, per spec, so every Other matches everyone.
-- ---------------------------------------------------------------------
create table universities (
  value      text primary key,
  label      text not null,
  group_key  text not null,
  sort_order int  not null
);

-- ---------------------------------------------------------------------
-- players
-- university_group is resolved once at join (from `universities`, or a
-- unique per-player value for 'other') and is what rule checks compare —
-- never `university_value` directly, so label/grouping changes can never
-- silently change who matches whom mid-event.
-- ---------------------------------------------------------------------
create table players (
  id                    uuid primary key default gen_random_uuid(),
  event_id              uuid not null references events(id) on delete cascade,
  display_name          text not null check (length(btrim(display_name)) between 1 and 60),
  university_value      text not null references universities(value),
  university_other_text text check (university_other_text is null
                            or length(btrim(university_other_text)) between 1 and 60),
  university_group      text not null,
  joined_at             timestamptz not null default now(),
  joined_late           boolean not null default false,
  removed_at            timestamptz,
  last_seen_at          timestamptz not null default now(),
  constraint players_other_text_required check (
    (university_value <> 'other' and university_other_text is null) or
    (university_value =  'other' and university_other_text is not null)
  )
);
create index players_event_active_idx on players(event_id) where removed_at is null;
create index players_event_uni_idx    on players(event_id, university_value);
create index players_event_joined_idx on players(event_id, joined_at);

-- ---------------------------------------------------------------------
-- cards + card_squares
-- The two unique constraints together force each card to be a true
-- permutation of the 25 criteria: every grid position used once, every
-- criterion used once. A buggy shuffle cannot produce a duplicate.
-- ---------------------------------------------------------------------
create table cards (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (player_id)
);

create table card_squares (
  id                  uuid primary key default gen_random_uuid(),
  card_id             uuid not null references cards(id) on delete cascade,
  idx                 int  not null check (idx between 0 and 24),
  criterion_id        uuid not null references criteria(id),
  status              text not null default 'empty'
                        check (status in ('empty','filled')),
  filled_by_player_id uuid references players(id) on delete set null,
  -- Denormalized at fill time, deliberately. This is the visible reward on
  -- the card and the record "People I met" reads from — it must survive
  -- even if the matched player is later admin-removed, so it is never
  -- re-derived from a join.
  filled_by_name       text,
  filled_by_university text,
  filled_at             timestamptz,
  unique (card_id, idx),
  unique (card_id, criterion_id),
  -- A non-filled square never carries stale attribution. A filled square
  -- always carries its full snapshot together.
  constraint card_squares_fill_consistent check (
    (status = 'filled' and filled_at is not null
       and filled_by_name is not null and filled_by_university is not null) or
    (status <> 'filled' and filled_by_player_id is null and filled_at is null
       and filled_by_name is null and filled_by_university is null)
  )
);
create index card_squares_card_idx on card_squares(card_id, idx);

-- ---------------------------------------------------------------------
-- posts — the Requests & Offers board
-- client_key makes every write idempotent: a retry after a timeout on
-- flaky venue wifi re-sends the same key and cannot double-post.
-- ---------------------------------------------------------------------
create table posts (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  player_id      uuid not null references players(id) on delete cascade,
  criterion_id   uuid not null references criteria(id),
  card_square_id uuid references card_squares(id) on delete set null,
  kind           text not null check (kind in ('request','offer')),
  status         text not null default 'open' check (status in ('open','closed')),
  note           text check (note is null or length(btrim(note)) between 1 and 200),
  client_key     text not null,
  created_at     timestamptz not null default now(),
  closed_at      timestamptz,
  hidden_at      timestamptz,
  unique (player_id, client_key)
);
create index posts_event_feed_idx on posts(event_id, created_at desc);
create index posts_event_open_idx on posts(event_id, status) where hidden_at is null;
create index posts_criterion_idx  on posts(criterion_id);

create table replies (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references posts(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 280),
  client_key text not null,
  created_at timestamptz not null default now(),
  hidden_at  timestamptz,
  unique (player_id, client_key)
);
create index replies_post_idx on replies(post_id, created_at);

-- ---------------------------------------------------------------------
-- fill_events — idempotency ledger for scan-fills, same pattern as posts
-- and replies: a client-generated key means a retry after flaky venue
-- wifi replays the stored result instead of double-filling (or erroring
-- on "already filled" for what was actually its own request).
-- ---------------------------------------------------------------------
create table fill_events (
  id         uuid primary key default gen_random_uuid(),
  square_id  uuid not null references card_squares(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  client_key text not null,
  result     jsonb not null,
  created_at timestamptz not null default now(),
  unique (square_id, client_key)
);

-- ---------------------------------------------------------------------
-- pair_matches — the "no farming one friend" cap, enforced by CHECK.
-- Unordered pair, so it counts matches in both directions.
-- ---------------------------------------------------------------------
create table pair_matches (
  event_id      uuid not null references events(id) on delete cascade,
  player_lo     uuid not null references players(id) on delete cascade,
  player_hi     uuid not null references players(id) on delete cascade,
  matched_count int not null default 0 check (matched_count between 0 and 2),
  primary key (event_id, player_lo, player_hi),
  constraint pair_ordered check (player_lo < player_hi)
);

-- ---------------------------------------------------------------------
-- bingos
-- elapsed_ms is frozen at insert time rather than derived later, so a
-- pause after the fact can never retroactively change someone's score.
-- ---------------------------------------------------------------------
create table bingos (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  line_key   text not null check (line_key ~ '^(row:[0-4]|col:[0-4]|diag:[01])$'),
  elapsed_ms bigint not null check (elapsed_ms >= 0),
  bingo_at   timestamptz not null default now(),
  unique (event_id, player_id, line_key)
);
create index bingos_event_time_idx on bingos(event_id, bingo_at);

-- ---------------------------------------------------------------------
-- rate_events — per-player rate limiting that works across serverless
-- instances, because in-memory buckets don't on Vercel.
-- ---------------------------------------------------------------------
create table rate_events (
  id         bigserial primary key,
  player_id  uuid not null references players(id) on delete cascade,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index rate_events_lookup_idx on rate_events(player_id, kind, created_at desc);
