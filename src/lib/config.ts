export const GRID = 5;
export const SQUARE_COUNT = GRID * GRID;

export const EVENT_SLUG = process.env.NEXT_PUBLIC_EVENT_SLUG ?? 'gsg-clubs';
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Column headers across the top of the card. */
export const HEADERS = ['B', 'I', 'N', 'G', 'O'] as const;

/**
 * The join form's university dropdown. This mirrors db/seed.sql's
 * `universities` table for instant, offline-safe rendering — but it is
 * never the source of truth: rpc_join validates `value` against the real
 * table server-side regardless of what the client sends, and a mismatch
 * here would just mean an ugly error, not a bad match.
 */
export const UNIVERSITIES = [
  { value: 'aqu', label: 'Al-Quds University (AQU)' },
  { value: 'aaup_rihan', label: 'Arab American University, Rihan (AAUP)' },
  { value: 'aaup_jenin', label: 'Arab American University, Jenin (AAUP)' },
  { value: 'hu', label: 'Hebron University (HU)' },
  { value: 'bzu', label: 'Birzeit University (BZU)' },
  { value: 'ppu', label: 'Palestine Polytechnic University (PPU)' },
  { value: 'nnu', label: 'An-Najah National University (NNU)' },
  { value: 'other', label: 'Other' },
] as const;

/** Storage keys. Versioned so a breaking change can invalidate cleanly. */
export const STORAGE = {
  token: 'gsg-bingo.token.v1',
  player: 'gsg-bingo.player.v1',
  queue: 'gsg-bingo.queue.v1',
  seenRules: 'gsg-bingo.rules-seen.v1',
  cardView: 'gsg-bingo.card-view.v1',
} as const;

/**
 * Poll cadences. Polling is the primary transport, not the fallback:
 * Supabase's free tier caps Realtime at 200 concurrent connections and
 * this event expects up to 300 phones. When a client does win a Realtime
 * slot we back the poll off to a slow heartbeat and let push do the work.
 */
export const POLL_MS = {
  live: 3_000,
  withRealtime: 15_000,
  hidden: 30_000,
  lobby: 2_000,
} as const;
