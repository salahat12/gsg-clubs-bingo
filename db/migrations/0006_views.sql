-- =====================================================================
-- 0006_views.sql — read models.
-- Clients read these directly from Supabase with the anon key, which
-- keeps the 3-second poll off Vercel entirely. security_invoker = true
-- so they respect the RLS policies of the underlying tables rather than
-- silently running as the view owner.
-- =====================================================================

-- Lobby roster: one row per live player, for the constellation.
create view v_lobby_players with (security_invoker = true) as
select p.id, p.event_id, p.display_name, p.university, p.university_key,
       p.club, p.joined_at, p.joined_late
from players p
where p.removed_at is null;

-- Per-university headcount, so the lobby does not have to count 300 rows
-- client-side on every poll.
create view v_lobby_clusters with (security_invoker = true) as
select p.event_id,
       p.university_key,
       min(p.university)  as university,
       count(*)::int      as player_count,
       min(p.joined_at)   as first_joined_at
from players p
where p.removed_at is null
group by p.event_id, p.university_key;

-- The board feed, pre-joined so rendering a page of posts is one query
-- instead of N+1. Hidden posts and removed players drop out here, which
-- means moderation takes effect everywhere at once.
create view v_board_posts with (security_invoker = true) as
select po.id, po.event_id, po.player_id, po.criterion_id, po.card_square_id,
       po.kind, po.status, po.note, po.created_at, po.closed_at,
       pl.display_name, pl.university, pl.club,
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
       pl.display_name, pl.university, pl.club, pl.event_id
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
       p.display_name, p.university, p.club, p.joined_late,
       fb.bingo_at, fb.elapsed_ms,
       fb.line_key as first_line,
       lc.lines_completed
from first_bingo fb
join players    p  on p.id = fb.player_id and p.removed_at is null
join line_counts lc on lc.player_id = fb.player_id;

-- A player's card, with criterion text and who filled each square.
create view v_card_squares with (security_invoker = true) as
select cs.id, cs.card_id, c.player_id, c.event_id, cs.idx, cs.criterion_id,
       cs.status, cs.filled_by_player_id, cs.filled_at,
       cr.text     as criterion_text,
       cr.position as criterion_position,
       cr.rule     as criterion_rule,
       fp.display_name as filled_by_name,
       fp.university   as filled_by_university,
       fp.club         as filled_by_club
from card_squares cs
join cards    c  on c.id  = cs.card_id
join criteria cr on cr.id = cs.criterion_id
left join players fp on fp.id = cs.filled_by_player_id;

-- Pending confirmations, pre-joined so the prompt can render immediately.
create view v_pending_confirmations with (security_invoker = true) as
select mc.id, mc.event_id, mc.requester_id, mc.confirmer_id, mc.criterion_id,
       mc.requester_square_id, mc.status, mc.created_at, mc.post_id,
       rp.display_name as requester_name,
       rp.university   as requester_university,
       rp.club         as requester_club,
       cp.display_name as confirmer_name,
       cr.text         as criterion_text
from match_confirmations mc
join players  rp on rp.id = mc.requester_id
join players  cp on cp.id = mc.confirmer_id
join criteria cr on cr.id = mc.criterion_id
where mc.status = 'pending';

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
     where po.event_id = e.id and po.hidden_at is null)::int            as posts_count,
  (select count(*) from match_confirmations m
     where m.event_id = e.id and m.status = 'pending')::int             as pending_matches
from events e;

-- Autocomplete source for the join form. Everyone converging on the same
-- spelling of a university matters: criterion 1 is validated by comparing
-- them, so "IUG" and "I.U.G." would silently become different places.
create view v_clubs with (security_invoker = true) as
select p.event_id, p.club_key, min(p.club) as club, count(*)::int as player_count
from players p
where p.removed_at is null
group by p.event_id, p.club_key;
