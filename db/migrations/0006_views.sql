-- =====================================================================
-- 0006_views.sql — read models.
-- Clients read these directly from Supabase with the anon key, which
-- keeps the 3-second poll off Vercel entirely. security_invoker = true
-- so they respect the RLS policies of the underlying tables rather than
-- silently running as the view owner.
-- =====================================================================

-- Lobby roster: one row per live player, for the constellation.
create view v_lobby_players with (security_invoker = true) as
select p.id, p.event_id, p.display_name,
       p.university_value, university_label(p.id) as university,
       p.joined_at, p.joined_late
from players p
where p.removed_at is null;

-- Per-university headcount, so the lobby does not have to count 300 rows
-- client-side on every poll. Grouped by university_value (display), not
-- university_group (matching) — Rihan and Jenin show as separate
-- clusters, and every "Other" collapses into one rather than 300 clusters
-- of one.
create view v_lobby_clusters with (security_invoker = true) as
select p.event_id,
       p.university_value,
       min(university_label(p.id)) as university,
       count(*)::int                as player_count,
       min(p.joined_at)             as first_joined_at
from players p
where p.removed_at is null
group by p.event_id, p.university_value;

-- The board feed, pre-joined so rendering a page of posts is one query
-- instead of N+1. Hidden posts and removed players drop out here, which
-- means moderation takes effect everywhere at once.
create view v_board_posts with (security_invoker = true) as
select po.id, po.event_id, po.player_id, po.criterion_id, po.card_square_id,
       po.kind, po.status, po.note, po.created_at, po.closed_at,
       pl.display_name, university_label(pl.id) as university,
       cr.text     as criterion_text,
       cr.position as criterion_position,
       (select count(*) from replies r
         where r.post_id = po.id and r.hidden_at is null)::int as reply_count,
       (select max(r.created_at) from replies r
         where r.post_id = po.id and r.hidden_at is null)      as last_reply_at
from posts po
join players  pl on pl.id = po.player_id
join criteria cr on cr.id = po.criterion_id
where po.hidden_at is null and pl.removed_at is null;

create view v_board_replies with (security_invoker = true) as
select r.id, r.post_id, r.player_id, r.body, r.created_at,
       pl.display_name, university_label(pl.id) as university, pl.event_id
from replies r
join players pl on pl.id = r.player_id
where r.hidden_at is null and pl.removed_at is null;

-- Leaderboard: a player appears once, at their FIRST bingo. Later lines
-- become the tiebreak column. elapsed_ms was frozen when the line
-- completed, so this view is stable no matter what happens afterwards.
create view v_leaderboard with (security_invoker = true) as
with first_bingo as (
  select distinct on (player_id)
         player_id, event_id, bingo_at, elapsed_ms, line_key
  from bingos
  order by player_id, bingo_at asc, id asc
),
line_counts as (
  select player_id, count(*)::int as lines_completed
  from bingos group by player_id
)
select fb.player_id, fb.event_id,
       p.display_name, university_label(p.id) as university, p.joined_late,
       fb.bingo_at, fb.elapsed_ms,
       fb.line_key as first_line,
       lc.lines_completed
from first_bingo fb
join players    p  on p.id = fb.player_id and p.removed_at is null
join line_counts lc on lc.player_id = fb.player_id;

-- Top Helpers: the players other people scanned most. Not capped by the
-- pair cap on the count itself — the cap only limits any single pair to
-- 2, so a high count here is necessarily spread across distinct people.
-- Its own leaderboard: a second prize for a room where only one person
-- can win the speed race.
create view v_top_helpers with (security_invoker = true) as
select c.event_id, cs.filled_by_player_id as player_id,
       min(p.display_name)          as display_name,
       min(university_label(p.id))  as university,
       count(*)::int                as helped_count
from card_squares cs
join cards   c on c.id = cs.card_id
join players p on p.id = cs.filled_by_player_id
where cs.status = 'filled' and p.removed_at is null
group by c.event_id, cs.filled_by_player_id;

-- A player's card, with criterion text and who filled each square.
create view v_card_squares with (security_invoker = true) as
select cs.id, cs.card_id, c.player_id, c.event_id, cs.idx, cs.criterion_id,
       cs.status, cs.filled_by_player_id, cs.filled_by_name,
       cs.filled_by_university, cs.filled_at,
       cr.text     as criterion_text,
       cr.position as criterion_position,
       cr.rule     as criterion_rule
from card_squares cs
join cards    c  on c.id  = cs.card_id
join criteria cr on cr.id = cs.criterion_id;

-- Every fill, newest first — the admin live feed and the source for a
-- player's own "People I met" (filtered client-side by owner_id).
create view v_fill_feed with (security_invoker = true) as
select cs.id as square_id, c.event_id, c.player_id as owner_id,
       owner.display_name as owner_name,
       cs.criterion_id, cr.text as criterion_text, cr.position as criterion_position,
       cs.filled_by_player_id, cs.filled_by_name, cs.filled_by_university, cs.filled_at
from card_squares cs
join cards    c     on c.id = cs.card_id
join players  owner on owner.id = c.player_id
join criteria cr    on cr.id = cs.criterion_id
where cs.status = 'filled';

-- Live counters for the admin dashboard.
create view v_event_stats with (security_invoker = true) as
select e.id as event_id, e.slug, e.status, e.started_at, e.join_open,
  (select count(*) from players pl
     where pl.event_id = e.id and pl.removed_at is null)::int          as players_joined,
  (select count(*) from cards ca where ca.event_id = e.id)::int         as cards_dealt,
  (select count(*) from card_squares cs join cards ca on ca.id = cs.card_id
     where ca.event_id = e.id and cs.status = 'filled')::int            as squares_filled,
  (select count(distinct b.player_id) from bingos b
     where b.event_id = e.id)::int                                     as players_with_bingo,
  (select count(*) from bingos b where b.event_id = e.id)::int          as lines_completed,
  (select count(*) from posts po
     where po.event_id = e.id and po.hidden_at is null)::int            as posts_count
from events e;
