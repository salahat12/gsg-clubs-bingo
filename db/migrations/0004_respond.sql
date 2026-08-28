-- =====================================================================
-- 0004_respond.sql — rpc_scan_fill
--
-- The function that decides the game, now triggered by a scan instead of
-- a two-step approval. It runs as one transaction and takes row locks in
-- a fixed order (square -> pair) so concurrent fills serialise instead of
-- interleaving.
--
-- Identity of the scanned player is NEVER taken as a bare parameter from
-- the client here — the caller (a Next.js route holding SCAN_TOKEN_SECRET)
-- verifies the rotating scan token/code first and passes in the player id
-- it already proved out of that signature. This function trusts that id
-- exactly as much as it trusts p_scanning_player_id: both are the output
-- of server-side auth, never a raw request-body field. Token verification
-- itself lives in src/lib/scanToken.ts, mirroring how a player's own
-- session token is verified in src/lib/route.ts rather than in SQL — auth
-- lives in the route layer, game rules live here.
--
-- What it guarantees:
--   * a square is never self-filled (scanning player <> scanned player)
--   * a square already filled cannot be filled again
--   * criteria 4 and 7 are re-validated here, not just trusted from the UI
--   * the pair cap holds even if two fills land simultaneously
--   * BINGO is detected server-side, timestamped server-side
--   * a retried request (client_key) replays its stored result instead of
--     erroring on "already filled" or consuming a second pair-cap slot
-- =====================================================================

create or replace function rpc_scan_fill(
  p_scanning_player_id uuid,
  p_square_id           uuid,
  p_scanned_player_id   uuid,
  p_client_key          text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  scanning    players%rowtype;
  scanned     players%rowtype;
  sq          card_squares%rowtype;
  v_existing  fill_events%rowtype;
  v_used      int;
  v_new_lines text[] := '{}';
  v_uni       text;
  v_result    jsonb;
begin
  select * into v_existing from fill_events
   where square_id = p_square_id and client_key = p_client_key;
  if found then
    return v_existing.result;
  end if;

  scanning := get_live_player(p_scanning_player_id);
  perform assert_playable(scanning.event_id);
  perform assert_rate(p_scanning_player_id, 'scan_fill', 30, interval '1 minute');

  if p_scanning_player_id = p_scanned_player_id then
    raise exception 'You cannot scan your own code.' using errcode = 'GB300';
  end if;

  scanned := get_live_player(p_scanned_player_id);
  if scanned.event_id <> scanning.event_id then
    raise exception 'That player is not in this event.' using errcode = 'GB401';
  end if;

  select s.* into sq
  from card_squares s join cards c on c.id = s.card_id
  where s.id = p_square_id and c.player_id = p_scanning_player_id
  for update;
  if not found then
    raise exception 'That square is not on your card.' using errcode = 'GB403';
  end if;
  if sq.status = 'filled' then
    raise exception 'You have already filled that square.' using errcode = 'GB304';
  end if;

  v_used := pair_used(scanning.event_id, p_scanning_player_id, p_scanned_player_id);
  if v_used >= 2 then
    raise exception 'You have already matched with % twice.', scanned.display_name
      using errcode = 'GB301';
  end if;

  perform assert_criterion_rule(sq.criterion_id, p_scanning_player_id, p_scanned_player_id);

  v_uni := university_label(p_scanned_player_id);

  update card_squares
     set status = 'filled',
         filled_by_player_id = scanned.id,
         filled_by_name       = scanned.display_name,
         filled_by_university = v_uni,
         filled_at            = now()
   where id = sq.id;

  perform pair_consume(scanning.event_id, p_scanning_player_id, p_scanned_player_id, 1);

  v_new_lines := record_bingos(p_scanning_player_id);

  v_result := jsonb_build_object(
    'result',        'filled',
    'square_id',     sq.id,
    'scanned_id',    scanned.id,
    'scanned_name',  scanned.display_name,
    'scanned_university', v_uni,
    'new_lines',     to_jsonb(v_new_lines)
  );

  insert into fill_events (square_id, player_id, client_key, result)
  values (p_square_id, p_scanning_player_id, p_client_key, v_result);

  return v_result;
end $$;
