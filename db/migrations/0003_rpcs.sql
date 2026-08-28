-- =====================================================================
-- 0003_rpcs.sql — player-facing RPCs.
-- Called only from Next.js route handlers holding the service key.
-- The anon key has no execute grant on any of these (see 0007_rls.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Join. Creates the player, the card, and the card's shuffled layout in
-- one transaction. The layout is stored, not derived, so it is identical
-- on every reload and every device.
-- ---------------------------------------------------------------------
create or replace function rpc_join(
  p_event_slug            text,
  p_display_name          text,
  p_university_value      text,
  p_university_other_text text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e             events%rowtype;
  u             universities%rowtype;
  v_player_id   uuid := gen_random_uuid();
  v_card_id     uuid;
  v_active      int;
  v_group       text;
  v_other_text  text;
begin
  select * into e from events where slug = p_event_slug;
  if not found then
    raise exception 'That event does not exist.' using errcode = 'GB401';
  end if;
  if e.status = 'ended' then
    raise exception 'This event has ended.' using errcode = 'GB102';
  end if;
  if not e.join_open then
    raise exception 'Joining is closed for this event. Find an organiser if you just arrived.'
      using errcode = 'GB104';
  end if;

  select * into u from universities where value = p_university_value;
  if not found then
    raise exception 'Pick a university from the list.' using errcode = 'GB403';
  end if;

  if p_university_value = 'other' then
    v_other_text := nullif(btrim(coalesce(p_university_other_text, '')), '');
    if v_other_text is null then
      raise exception 'Type your university.' using errcode = 'GB403';
    end if;
    -- Each 'Other' is its own university for matching purposes: a unique
    -- group per player, so they match with everyone including each other.
    v_group := 'other-' || v_player_id::text;
  else
    v_other_text := null;
    v_group := u.group_key;
  end if;

  -- A 5x5 card needs exactly 25 criteria. If an organiser has broken the
  -- pool mid-event, fail loudly here rather than deal a malformed card.
  select count(*) into v_active from criteria where event_id = e.id and active;
  if v_active <> 25 then
    raise exception 'This event has % active criteria but a card needs exactly 25.', v_active
      using errcode = 'GB402';
  end if;

  insert into players
    (id, event_id, display_name, university_value, university_other_text,
     university_group, joined_late)
  values
    (v_player_id, e.id, btrim(p_display_name), p_university_value, v_other_text,
     v_group, e.status <> 'waiting');

  insert into cards (event_id, player_id) values (e.id, v_player_id) returning id into v_card_id;

  -- The shuffle. The two unique constraints on card_squares guarantee
  -- this lands as a genuine permutation of the 25.
  insert into card_squares (card_id, idx, criterion_id)
  select v_card_id, (row_number() over (order by random()))::int - 1, c.id
  from criteria c
  where c.event_id = e.id and c.active;

  return jsonb_build_object(
    'player_id', v_player_id,
    'card_id',   v_card_id,
    'event_id',  e.id,
    'joined_late', e.status <> 'waiting'
  );
end $$;

-- ---------------------------------------------------------------------
-- Post to the board. Idempotent on (player_id, client_key) so the retry
-- queue can replay a timed-out request without double-posting.
-- ---------------------------------------------------------------------
create or replace function rpc_create_post(
  p_player_id  uuid,
  p_square_id  uuid,
  p_kind       text,
  p_note       text,
  p_client_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p          players%rowtype;
  sq         card_squares%rowtype;
  v_existing posts%rowtype;
  v_post_id  uuid;
  v_dupe     uuid;
begin
  p := get_live_player(p_player_id);
  perform assert_playable(p.event_id);

  select * into v_existing from posts where player_id = p_player_id and client_key = p_client_key;
  if found then
    return jsonb_build_object('post_id', v_existing.id, 'idempotent', true);
  end if;

  if p_kind not in ('request', 'offer') then
    raise exception 'Unknown post type.' using errcode = 'GB403';
  end if;

  select s.* into sq
  from card_squares s join cards c on c.id = s.card_id
  where s.id = p_square_id and c.player_id = p_player_id;
  if not found then
    raise exception 'That square is not on your card.' using errcode = 'GB403';
  end if;

  if p_kind = 'request' and sq.status = 'filled' then
    raise exception 'You have already filled that square.' using errcode = 'GB304';
  end if;

  select id into v_dupe from posts
  where player_id = p_player_id and card_square_id = p_square_id
    and kind = p_kind and status = 'open' and hidden_at is null
  limit 1;
  if v_dupe is not null then
    raise exception 'You already have an open % for that square.', p_kind using errcode = 'GB403';
  end if;

  perform assert_rate(p_player_id, 'post', 10, interval '1 minute');

  insert into posts (event_id, player_id, criterion_id, card_square_id, kind, note, client_key)
  values (p.event_id, p_player_id, sq.criterion_id, sq.id, p_kind,
          nullif(btrim(coalesce(p_note, '')), ''), p_client_key)
  returning id into v_post_id;

  return jsonb_build_object('post_id', v_post_id, 'idempotent', false);
end $$;

create or replace function rpc_create_reply(
  p_player_id uuid, p_post_id uuid, p_body text, p_client_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p          players%rowtype;
  po         posts%rowtype;
  v_existing replies%rowtype;
  v_id       uuid;
begin
  p := get_live_player(p_player_id);
  perform assert_playable(p.event_id);

  select * into v_existing from replies where player_id = p_player_id and client_key = p_client_key;
  if found then
    return jsonb_build_object('reply_id', v_existing.id, 'idempotent', true);
  end if;

  select * into po from posts where id = p_post_id;
  if not found or po.hidden_at is not null then
    raise exception 'That post is no longer on the board.' using errcode = 'GB401';
  end if;

  perform assert_rate(p_player_id, 'reply', 20, interval '1 minute');

  insert into replies (post_id, player_id, body, client_key)
  values (p_post_id, p_player_id, btrim(p_body), p_client_key)
  returning id into v_id;

  return jsonb_build_object('reply_id', v_id, 'idempotent', false);
end $$;

create or replace function rpc_close_post(p_player_id uuid, p_post_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare po posts%rowtype;
begin
  perform get_live_player(p_player_id);
  select * into po from posts where id = p_post_id;
  if not found then
    raise exception 'That post no longer exists.' using errcode = 'GB401';
  end if;
  if po.player_id <> p_player_id then
    raise exception 'Only the person who posted this can close it.' using errcode = 'GB305';
  end if;
  update posts set status = 'closed', closed_at = now() where id = p_post_id and status = 'open';
  return jsonb_build_object('post_id', p_post_id, 'status', 'closed');
end $$;

