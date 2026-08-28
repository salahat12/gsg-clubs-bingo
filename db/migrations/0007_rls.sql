-- =====================================================================
-- 0007_rls.sql — Row Level Security.
--
-- The posture, stated plainly:
--   * the anon key can READ public game state and can WRITE NOTHING.
--     There is not a single INSERT/UPDATE/DELETE policy in this file.
--   * every write goes through a Next.js route handler holding the
--     service key, which alone may execute the rpc_* functions.
--   * EXECUTE on functions is revoked from anon/authenticated. Without
--     this, PostgREST would happily let anyone call a SECURITY DEFINER
--     function over HTTP and bypass the entire design.
--
-- Accepted trade-off: anon can read other players' cards. It gains an
-- attacker nothing — filling a square still needs a real human to tap
-- confirm — and the per-player shuffle exists to stop shoulder-surfing
-- at the venue, not scraping.
-- =====================================================================

alter table events        enable row level security;
alter table universities  enable row level security;
alter table criteria      enable row level security;
alter table players       enable row level security;
alter table cards         enable row level security;
alter table card_squares  enable row level security;
alter table posts         enable row level security;
alter table replies       enable row level security;
alter table pair_matches  enable row level security;
alter table bingos        enable row level security;
alter table rate_events   enable row level security;
alter table fill_events   enable row level security;

-- ---------------------------------------------------------------------
-- Read policies. Explicit, one per table, all SELECT-only.
-- ---------------------------------------------------------------------
create policy events_public_read on events
  for select to anon, authenticated using (true);

-- The join form's dropdown reads this directly; it's a fixed lookup, not
-- sensitive, and stable `value`s are what the client submits to rpc_join.
create policy universities_public_read on universities
  for select to anon, authenticated using (true);

create policy criteria_public_read on criteria
  for select to anon, authenticated using (active);

-- Removed players disappear from every client immediately.
create policy players_public_read on players
  for select to anon, authenticated using (removed_at is null);

create policy cards_public_read on cards
  for select to anon, authenticated using (true);

create policy card_squares_public_read on card_squares
  for select to anon, authenticated using (true);

-- Moderation is a read-level fact, not a client-side filter.
create policy posts_public_read on posts
  for select to anon, authenticated using (hidden_at is null);

create policy replies_public_read on replies
  for select to anon, authenticated using (hidden_at is null);

create policy bingos_public_read on bingos
  for select to anon, authenticated using (true);

-- pair_matches, rate_events and fill_events get RLS with NO policy at
-- all: deny by default. They are internal bookkeeping and no client
-- needs them — fill_events in particular is just the idempotency ledger,
-- read only by the service role inside rpc_scan_fill itself.

-- ---------------------------------------------------------------------
-- Grants. Start from nothing and hand back only SELECT.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;

grant select on
  events, universities, criteria, players, cards, card_squares, posts, replies, bingos
to anon, authenticated;

grant select on
  v_lobby_players, v_lobby_clusters, v_board_posts, v_board_replies,
  v_leaderboard, v_top_helpers, v_card_squares, v_fill_feed, v_event_stats
to anon, authenticated;

-- ---------------------------------------------------------------------
-- The important one: no client may call the rules engine directly.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from anon, authenticated, public;

-- The one deliberate exception: a pure read-only label lookup that the
-- read-model views above call. It exposes nothing anon couldn't already
-- read directly off `players`/`universities` — it is not part of the
-- rules engine.
grant execute on function university_label(uuid) to anon, authenticated;

grant execute on all functions in schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------
-- Realtime. Wrapped in a guard because the publication only exists on
-- Supabase — the local PGlite test harness runs the same migration.
-- Realtime is an accelerator here, never a dependency: if a client
-- cannot get one of the free tier's 200 slots it stays on polling.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table events;
    alter publication supabase_realtime add table players;
    alter publication supabase_realtime add table posts;
    alter publication supabase_realtime add table replies;
    alter publication supabase_realtime add table card_squares;
    alter publication supabase_realtime add table bingos;
  end if;
end $$;
