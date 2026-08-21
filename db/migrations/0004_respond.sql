-- =====================================================================
-- 0004_respond.sql — rpc_respond_match
--
-- The function that decides the game. It runs as one transaction and
-- takes row locks in a fixed order (confirmation -> square -> pair) so
-- concurrent confirmations serialise instead of interleaving.
--
-- What it guarantees:
--   * a square is never self-marked (confirmer <> requester, twice over)
--   * a square already filled cannot be filled again
--   * criteria 1 and 22 are re-validated at confirmation time, not just
--     at request time, because a player can edit nothing but an admin can
--   * the pair cap holds even if two confirmations land simultaneously
--   * BINGO is detected server-side, timestamped server-side
-- =====================================================================

create or replace function rpc_respond_match(
  p_confirmation_id     uuid,
  p_confirmer_id        uuid,
  p_action              text,
  p_reciprocal_square_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  mc            match_confirmations%rowtype;
  sq            card_squares%rowtype;
  rsq           card_squares%rowtype;
  req           players%rowtype;
  conf          players%rowtype;
  v_used        int;
  v_want        int;
  v_new_lines   text[] := '{}';
  v_recip_lines text[] := '{}';
  v_recip_id    uuid;
  v_recip_done  boolean := false;
  v_recip_note  text := null;
begin
  select * into mc from match_confirmations where id = p_confirmation_id for update;
  if not found then
    raise exception 'That match request no longer exists.' using errcode = 'GB401';
  end if;
  if mc.confirmer_id <> p_confirmer_id then
    raise exception 'That confirmation was not sent to you.' using errcode = 'GB305';
  end if;
  if mc.status <> 'pending' then
    raise exception 'You have already answered this one.' using errcode = 'GB306';
  end if;

  perform assert_playable(mc.event_id);

  -- ---------------- decline ----------------
  if p_action = 'decline' then
    update match_confirmations
       set status = 'declined', responded_at = now()
     where id = mc.id;
    update card_squares set status = 'empty'
     where id = mc.requester_square_id and status = 'pending';
    -- put the post back on the board so they can find someone else
    update posts set status = 'open', closed_at = null
     where id = mc.post_id and status = 'closed';
    return jsonb_build_object('result', 'declined');
  end if;

  if p_action <> 'confirm' then
    raise exception 'Unknown action.' using errcode = 'GB403';
  end if;

  -- ---------------- confirm ----------------
  req  := get_live_player(mc.requester_id);
  conf := get_live_player(mc.confirmer_id);

  -- belt and braces: the CHECK constraint already forbids this, but the
  -- rule is important enough to state twice
  if req.id = conf.id then
    raise exception 'You cannot mark yourself as your own match.' using errcode = 'GB300';
  end if;

  select * into sq from card_squares where id = mc.requester_square_id for update;
  if sq.status = 'filled' then
    raise exception 'That square was already filled by someone else.' using errcode = 'GB304';
  end if;

  perform assert_criterion_rule(mc.criterion_id, req.id, conf.id);

  -- Pair budget. We want 1 for the main match, 2 if they are also
  -- filling one of their own. If only the reciprocal would overflow, we
  -- still complete the main match and explain why the extra was skipped.
  v_used := pair_used(mc.event_id, req.id, conf.id);
  v_want := case when p_reciprocal_square_id is not null then 2 else 1 end;

  if v_used + 1 > 2 then
    raise exception 'You two have already matched twice. Each pair can fill at most 2 squares.'
      using errcode = 'GB301';
  end if;
  if v_used + v_want > 2 then
    v_recip_note := 'Your own square was not filled — you two have used both of your shared matches.';
    p_reciprocal_square_id := null;
  end if;

  update card_squares
     set status = 'filled', filled_by_player_id = conf.id, filled_at = now()
   where id = sq.id;

  update match_confirmations set status = 'confirmed', responded_at = now() where id = mc.id;

  update posts set status = 'closed', closed_at = now()
   where id = mc.post_id and status = 'open';

  perform pair_consume(mc.event_id, req.id, conf.id, 1);

  v_new_lines := record_bingos(req.id);

  -- ---------------- optional reciprocal fill ----------------
  -- They just met in person, so the confirmer may fill one of their own
  -- squares in the same breath. They choose which one; nothing is
  -- auto-filled, and it still passes every rule check and the pair cap.
  if p_reciprocal_square_id is not null then
    select s.* into rsq
    from card_squares s join cards c on c.id = s.card_id
    where s.id = p_reciprocal_square_id and c.player_id = conf.id
    for update;

    if not found then
      raise exception 'That square is not on your card.' using errcode = 'GB403';
    end if;
    if rsq.status = 'filled' then
      raise exception 'You have already filled that square.' using errcode = 'GB304';
    end if;

    -- roles reverse here: the confirmer is now the one being vouched for
    perform assert_criterion_rule(rsq.criterion_id, conf.id, req.id);

    insert into match_confirmations
      (event_id, post_id, requester_id, confirmer_id, criterion_id,
       requester_square_id, status, reciprocal_of, responded_at)
    values
      (mc.event_id, mc.post_id, conf.id, req.id, rsq.criterion_id,
       rsq.id, 'confirmed', mc.id, now())
    returning id into v_recip_id;

    update card_squares
       set status = 'filled', filled_by_player_id = req.id, filled_at = now()
     where id = rsq.id;

    perform pair_consume(mc.event_id, req.id, conf.id, 1);

    v_recip_lines := record_bingos(conf.id);
    v_recip_done  := true;
  end if;

  return jsonb_build_object(
    'result',             'confirmed',
    'square_id',          sq.id,
    'requester_id',       req.id,
    'requester_name',     req.display_name,
    'confirmer_name',     conf.display_name,
    'new_lines',          to_jsonb(v_new_lines),
    'reciprocal_filled',  v_recip_done,
    'reciprocal_id',      v_recip_id,
    'reciprocal_lines',   to_jsonb(v_recip_lines),
    'note',               v_recip_note
  );
end $$;

-- Let the requester take back a pending ask (they found someone else, or
-- the other person wandered off).
create or replace function rpc_cancel_match(p_confirmation_id uuid, p_requester_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mc match_confirmations%rowtype;
begin
  select * into mc from match_confirmations where id = p_confirmation_id for update;
  if not found then
    raise exception 'That match request no longer exists.' using errcode = 'GB401';
  end if;
  if mc.requester_id <> p_requester_id then
    raise exception 'Only the person who asked can cancel this.' using errcode = 'GB305';
  end if;
  if mc.status <> 'pending' then
    raise exception 'That request has already been answered.' using errcode = 'GB306';
  end if;

  update match_confirmations set status = 'cancelled', responded_at = now() where id = mc.id;
  update card_squares set status = 'empty'
   where id = mc.requester_square_id and status = 'pending';

  return jsonb_build_object('result', 'cancelled');
end $$;
