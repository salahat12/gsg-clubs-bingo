import { browserClient } from './supabase';
import { EVENT_SLUG } from './config';
import type {
  BoardFilter, BoardPost, BoardReply, BoardSort, CardSquare, Criterion, EventState,
  EventStats, FillFeedRow, LeaderboardRow, LobbyCluster, LobbyPlayer, TopHelperRow,
} from './types';

/**
 * Reads go straight from the browser to Supabase with the anon key, never
 * through a Vercel function. At 300 players polling every three seconds
 * that is ~100 requests a second: fine for Postgres, and a waste of a
 * serverless budget. Row Level Security is what makes it safe — the anon
 * key can read these views and write nothing.
 */
const db = () => browserClient();

const rows = <T>(res: { data: T[] | null; error: unknown }): T[] => {
  if (res.error) throw res.error;
  return res.data ?? [];
};
const one = <T>(res: { data: T | null; error: unknown }): T | null => {
  if (res.error) throw res.error;
  return res.data;
};

/** `%` and `_` are wildcards in ilike; a player typing them means them literally. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function fetchEvent(): Promise<EventState | null> {
  return one<EventState>(
    await db()
      .from('events')
      .select('id, slug, name, status, started_at, ended_at, join_open, countdown_seconds, paused_ms')
      .eq('slug', EVENT_SLUG)
      .maybeSingle(),
  );
}

export async function fetchCriteria(eventId: string): Promise<Criterion[]> {
  return rows<Criterion>(
    await db()
      .from('criteria')
      .select('id, position, text, rule')
      .eq('event_id', eventId)
      .order('position'),
  );
}

// ---------------------------------------------------------------- lobby
export async function fetchLobbyClusters(eventId: string): Promise<LobbyCluster[]> {
  return rows<LobbyCluster>(
    await db()
      .from('v_lobby_clusters')
      .select('*')
      .eq('event_id', eventId)
      .order('player_count', { ascending: false }),
  );
}

export async function fetchLobbyPlayers(eventId: string, limit = 400): Promise<LobbyPlayer[]> {
  return rows<LobbyPlayer>(
    await db()
      .from('v_lobby_players')
      .select('*')
      .eq('event_id', eventId)
      .order('joined_at', { ascending: true })
      .limit(limit),
  );
}

export async function fetchUniversitySuggestions(eventId: string): Promise<string[]> {
  const data = await rows<{ university: string }>(
    await db()
      .from('v_lobby_clusters')
      .select('university, player_count')
      .eq('event_id', eventId)
      .order('player_count', { ascending: false })
      .limit(40),
  );
  return data.map((d) => d.university);
}

// ---------------------------------------------------------------- board
export const BOARD_PAGE = 25;

export async function fetchBoard(
  eventId: string,
  opts: {
    filter?: BoardFilter;
    sort?: BoardSort;
    search?: string;
    playerId?: string | null;
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<BoardPost[]> {
  const { filter = 'all', sort = 'newest', search, playerId, cursor, limit = BOARD_PAGE } = opts;
  const ascending = sort === 'oldest';

  let q = db().from('v_board_posts').select('*').eq('event_id', eventId);

  if (filter === 'requests') q = q.eq('kind', 'request');
  else if (filter === 'offers') q = q.eq('kind', 'offer');
  else if (filter === 'open') q = q.eq('status', 'open');
  else if (filter === 'mine' && playerId) q = q.eq('player_id', playerId);

  if (search?.trim()) q = q.ilike('criterion_text', `%${escapeLike(search.trim())}%`);
  if (cursor) q = ascending ? q.gt('created_at', cursor) : q.lt('created_at', cursor);

  return rows<BoardPost>(await q.order('created_at', { ascending }).limit(limit));
}

export async function fetchReplies(postId: string): Promise<BoardReply[]> {
  return rows<BoardReply>(
    await db().from('v_board_replies').select('*').eq('post_id', postId).order('created_at'),
  );
}

/** One round trip for a whole thread list, so opening a thread is instant. */
export async function fetchRepliesFor(postIds: string[]): Promise<Record<string, BoardReply[]>> {
  if (!postIds.length) return {};
  const data = rows<BoardReply>(
    await db().from('v_board_replies').select('*').in('post_id', postIds).order('created_at'),
  );
  return data.reduce<Record<string, BoardReply[]>>((acc, r) => {
    (acc[r.post_id] ??= []).push(r);
    return acc;
  }, {});
}

export async function fetchPost(postId: string): Promise<BoardPost | null> {
  return one<BoardPost>(await db().from('v_board_posts').select('*').eq('id', postId).maybeSingle());
}

// ----------------------------------------------------------------- card
export async function fetchCard(playerId: string): Promise<CardSquare[]> {
  return rows<CardSquare>(
    await db().from('v_card_squares').select('*').eq('player_id', playerId).order('idx'),
  );
}

/** Every fill on my own card, newest first — "People I met". */
export async function fetchMyFills(playerId: string): Promise<FillFeedRow[]> {
  return rows<FillFeedRow>(
    await db()
      .from('v_fill_feed')
      .select('*')
      .eq('owner_id', playerId)
      .order('filled_at', { ascending: false }),
  );
}

/** Every fill event-wide, newest first — the admin live feed. */
export async function fetchFillFeed(eventId: string, limit = 100): Promise<FillFeedRow[]> {
  return rows<FillFeedRow>(
    await db()
      .from('v_fill_feed')
      .select('*')
      .eq('event_id', eventId)
      .order('filled_at', { ascending: false })
      .limit(limit),
  );
}

// ---------------------------------------------------------- leaderboard
export async function fetchLeaderboard(eventId: string, limit = 100): Promise<LeaderboardRow[]> {
  return rows<LeaderboardRow>(
    await db()
      .from('v_leaderboard')
      .select('*')
      .eq('event_id', eventId)
      .order('elapsed_ms', { ascending: true })
      .limit(limit),
  );
}

export async function fetchMyBingos(playerId: string): Promise<{ line_key: string; bingo_at: string }[]> {
  return rows<{ line_key: string; bingo_at: string }>(
    await db().from('bingos').select('line_key, bingo_at').eq('player_id', playerId),
  );
}

/** The second prize: most-scanned players, not capped by the pair cap. */
export async function fetchTopHelpers(eventId: string, limit = 3): Promise<TopHelperRow[]> {
  return rows<TopHelperRow>(
    await db()
      .from('v_top_helpers')
      .select('*')
      .eq('event_id', eventId)
      .order('helped_count', { ascending: false })
      .limit(limit),
  );
}

// ---------------------------------------------------------------- admin
export async function fetchStats(eventId: string): Promise<EventStats | null> {
  return one<EventStats>(
    await db().from('v_event_stats').select('*').eq('event_id', eventId).maybeSingle(),
  );
}
