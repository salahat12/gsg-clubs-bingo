-- =====================================================================
-- 0005_admin.sql — admin RPCs.
-- Reached only through /api/admin/*, behind the admin passphrase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Event lifecycle. 'start' stamps started_at into the near future: that
-- single value is both the countdown and the start gate.
-- ---------------------------------------------------------------------
create or replace function rpc_admin_event(
  p_event_slug text,
  p_action     text,
  p_confirm    text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e         events%rowtype;
  v_deleted int;
begin
  select * into e from events where slug = p_event_slug for update;
  if not found then
    raise exception 'That event does not exist.' using errcode = 'GB401';
  end if;

  if p_action = 'start' then
    if e.status <> 'waiting' then
      raise exception 'The event is already %.', e.status using errcode = 'GB403';
    end if;
    update events
       set status = 'running',
           started_at = now() + make_interval(secs => e.countdown_seconds)
     where id = e.id;

  elsif p_action = 'pause' then
    if e.status <> 'running' then
      raise exception 'Only a running event can be paused.' using errcode = 'GB403';
    end if;
    update events set status = 'paused', paused_at = now() where id = e.id;

  elsif p_action = 'resume' then
    if e.status <> 'paused' then
      raise exception 'Only a paused event can be resumed.' using errcode = 'GB403';
    end if;
    update events
       set status = 'running',
           paused_ms = paused_ms + greatest(0,
             (extract(epoch from (now() - coalesce(paused_at, now()))) * 1000)::bigint),
           paused_at = null
     where id = e.id;

  elsif p_action = 'end' then
    if e.status not in ('running', 'paused') then
      raise exception 'Only a running or paused event can be ended.' using errcode = 'GB403';
    end if;
    update events
       set status = 'ended',
           ended_at = now(),
           paused_ms = paused_ms + case when e.paused_at is null then 0 else greatest(0,
             (extract(epoch from (now() - e.paused_at)) * 1000)::bigint) end,
           paused_at = null
     where id = e.id;

  elsif p_action = 'open_join' then
    update events set join_open = true  where id = e.id;

  elsif p_action = 'close_join' then
    update events set join_open = false where id = e.id;

  elsif p_action = 'reset' then
    -- Destructive: wipes every player, card, post and BINGO for a rerun.
    -- Requires the slug typed back, so it cannot happen on a stray tap.
    if p_confirm is distinct from p_event_slug then
      raise exception 'To reset, type the event slug exactly: %', p_event_slug using errcode = 'GB403';
    end if;
    delete from players where event_id = e.id;   -- cascades to everything downstream
    get diagnostics v_deleted = row_count;
    update events
       set status = 'waiting', started_at = null, ended_at = null,
           paused_at = null, paused_ms = 0, join_open = true
     where id = e.id;
    return jsonb_build_object('action', 'reset', 'players_removed', v_deleted);

  else
    raise exception 'Unknown admin action: %', p_action using errcode = 'GB403';
  end if;

  select * into e from events where id = e.id;
  return jsonb_build_object(
    'action', p_action, 'status', e.status,
    'started_at', e.started_at, 'join_open', e.join_open
  );
end $$;

-- ---------------------------------------------------------------------
-- Edit a criterion in place. Text edits propagate to every card already
-- dealt, because cards reference criterion_id and never copy the text.
-- The count stays at 25 by design — a 5x5 grid has no other option.
-- ---------------------------------------------------------------------
create or replace function rpc_admin_update_criterion(
  p_criterion_id uuid, p_text text, p_rule text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c criteria%rowtype;
begin
  if p_rule is not null and p_rule not in ('honor','diff_university','diff_club_entity') then
    raise exception 'Unknown rule: %', p_rule using errcode = 'GB403';
  end if;
  update criteria
     set text = coalesce(nullif(btrim(p_text), ''), text),
         rule = coalesce(p_rule, rule),
         updated_at = now()
   where id = p_criterion_id
  returning * into c;
  if not found then
    raise exception 'That criterion does not exist.' using errcode = 'GB401';
  end if;
  return jsonb_build_object('id', c.id, 'position', c.position, 'text', c.text, 'rule', c.rule);
end $$;

-- ---------------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------------
create or replace function rpc_admin_hide_post(p_post_id uuid, p_hidden boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update posts set hidden_at = case when p_hidden then now() else null end where id = p_post_id;
  if not found then
    raise exception 'That post does not exist.' using errcode = 'GB401';
  end if;
  return jsonb_build_object('post_id', p_post_id, 'hidden', p_hidden);
end $$;

create or replace function rpc_admin_hide_reply(p_reply_id uuid, p_hidden boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update replies set hidden_at = case when p_hidden then now() else null end where id = p_reply_id;
  if not found then
    raise exception 'That reply does not exist.' using errcode = 'GB401';
  end if;
  return jsonb_build_object('reply_id', p_reply_id, 'hidden', p_hidden);
end $$;

-- Soft-remove: keeps their squares' history intact but invalidates their
-- token immediately, because get_live_player checks removed_at.
create or replace function rpc_admin_remove_player(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update players set removed_at = now() where id = p_player_id and removed_at is null;
  if not found then
    raise exception 'That player does not exist or is already removed.' using errcode = 'GB401';
  end if;
  update posts set status = 'closed', closed_at = now()
   where player_id = p_player_id and status = 'open';
  update match_confirmations set status = 'cancelled', responded_at = now()
   where status = 'pending' and (requester_id = p_player_id or confirmer_id = p_player_id);
  update card_squares set status = 'empty'
   where status = 'pending'
     and id in (select requester_square_id from match_confirmations
                where status = 'cancelled' and requester_id = p_player_id);
  return jsonb_build_object('player_id', p_player_id, 'removed', true);
end $$;

-- ---------------------------------------------------------------------
-- Undo a confirmed square. Refunds the pair budget and withdraws any
-- BINGO whose line no longer holds — the leaderboard must not keep a
-- line that has a hole in it.
-- ---------------------------------------------------------------------
create or replace function rpc_admin_undo_square(p_square_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sq        card_squares%rowtype;
  mc        match_confirmations%rowtype;
  v_player  uuid;
  v_event   uuid;
begin
  select * into sq from card_squares where id = p_square_id for update;
  if not found then
    raise exception 'That square does not exist.' using errcode = 'GB401';
  end if;
  if sq.status <> 'filled' then
    raise exception 'That square is not filled.' using errcode = 'GB403';
  end if;

  select c.player_id, c.event_id into v_player, v_event from cards c where c.id = sq.card_id;

  select * into mc from match_confirmations
   where requester_square_id = sq.id and status = 'confirmed'
   order by responded_at desc limit 1;

  update card_squares
     set status = 'empty', filled_by_player_id = null, filled_at = null
   where id = sq.id;

  if found then
    update match_confirmations set status = 'cancelled' where id = mc.id;
    update pair_matches
       set matched_count = greatest(0, matched_count - 1)
     where event_id = v_event
       and player_lo = least(mc.requester_id, mc.confirmer_id)
       and player_hi = greatest(mc.requester_id, mc.confirmer_id);
  end if;

  perform recompute_bingos(v_player);

  return jsonb_build_object('square_id', sq.id, 'player_id', v_player, 'status', 'empty');
end $$;

-- Set the countdown length before starting. Kept separate from the start
-- action so an organiser can rehearse with 0 and run the real thing with 3.
create or replace function rpc_admin_set_countdown(p_event_slug text, p_seconds int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_seconds < 0 or p_seconds > 30 then
    raise exception 'The countdown must be between 0 and 30 seconds.' using errcode = 'GB403';
  end if;
  update events set countdown_seconds = p_seconds where slug = p_event_slug;
  if not found then
    raise exception 'That event does not exist.' using errcode = 'GB401';
  end if;
  return jsonb_build_object('countdown_seconds', p_seconds);
end $$;
