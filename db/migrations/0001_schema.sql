-- =====================================================================
-- 0001_schema.sql — GSG Clubs Networking Bingo
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
-- `rule` drives server-side validation on confirmation:
--   honor            : the two people vouch for each other, no check
--   diff_university  : criterion 1  — universities must differ
--   diff_club_entity : criterion 22 — must be a different CLUB, where a
--                      club is identified by (university, club). So
--                      IEEE@IUG vs IEEE@AUG is a valid match, and
--                      GDSC@IUG vs IEEE@IUG is too; only the exact same
--                      club at the same university is rejected.
-- ---------------------------------------------------------------------
create table criteria (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  position   int  not null check (position between 1 and 25),
  text       text not null check (length(btrim(text)) between 1 and 300),
  rule       text not null default 'honor'
               check (rule in ('honor','diff_university','diff_club_entity')),
  active     boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (event_id, position)
);

-- ---------------------------------------------------------------------
-- players
-- *_key columns are generated, so grouping the lobby by university and
-- comparing universities during rule checks can never drift apart from
-- each other or be bypassed by inconsistent casing/whitespace.
-- ---------------------------------------------------------------------
create table players (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  display_name   text not null check (length(btrim(display_name)) between 1 and 60),
  university     text not null check (length(btrim(university)) between 1 and 60),
  club           text not null check (length(btrim(club)) between 1 and 60),
  university_key text generated always as (lower(btrim(university))) stored,
  club_key       text generated always as (lower(btrim(club))) stored,
  joined_at      timestamptz not null default now(),
  joined_late    boolean not null default false,
  removed_at     timestamptz,
  last_seen_at   timestamptz not null default now()
);
create index players_event_active_idx on players(event_id) where removed_at is null;
create index players_event_uni_idx    on players(event_id, university_key);
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
                        check (status in ('empty','pending','filled')),
  filled_by_player_id uuid references players(id) on delete set null,
  filled_at           timestamptz,
  unique (card_id, idx),
  unique (card_id, criterion_id),
  -- A non-filled square never carries stale attribution. A filled square
  -- always carries a timestamp, but filled_by_player_id is allowed to go
  -- null: hard-deleting a player fires ON DELETE SET NULL here, and "this
  -- square was filled by someone who has since been removed" is a real
  -- state, not a corrupt one.
  constraint card_squares_fill_consistent check (
    (status =  'filled' and filled_at is not null) or
    (status <> 'filled' and filled_by_player_id is null and filled_at is null)
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
-- match_confirmations
-- The person whose square gets filled is always `requester`; the person
-- who vouches is always `confirmer`. A square is never self-markable:
-- requester_id <> confirmer_id is a CHECK, not an app-level if.
-- ---------------------------------------------------------------------
create table match_confirmations (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references events(id) on delete cascade,
  post_id             uuid references posts(id) on delete set null,
  requester_id        uuid not null references players(id) on delete cascade,
  confirmer_id        uuid not null references players(id) on delete cascade,
  criterion_id        uuid not null references criteria(id),
  requester_square_id uuid not null references card_squares(id) on delete cascade,
  status              text not null default 'pending'
                        check (status in ('pending','confirmed','declined','cancelled')),
  reciprocal_of       uuid references match_confirmations(id) on delete set null,
  created_at          timestamptz not null default now(),
  responded_at        timestamptz,
  constraint mc_distinct_players check (requester_id <> confirmer_id),
  constraint mc_responded_consistent check (
    (status = 'pending' and responded_at is null) or
    (status <> 'pending' and responded_at is not null)
  )
);
-- at most one live confirmation per square: this is what makes the
-- 'pending' square state meaningful and stops two people racing into it
create unique index mc_one_pending_per_square
  on match_confirmations(requester_square_id) where status = 'pending';
create index mc_inbox_idx  on match_confirmations(confirmer_id) where status = 'pending';
create index mc_outbox_idx on match_confirmations(requester_id) where status = 'pending';

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
