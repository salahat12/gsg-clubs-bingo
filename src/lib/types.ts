export type EventStatus = 'waiting' | 'running' | 'paused' | 'ended';

export type EventState = {
  id: string;
  slug: string;
  name: string;
  status: EventStatus;
  started_at: string | null;
  ended_at: string | null;
  join_open: boolean;
  countdown_seconds: number;
  paused_ms: number;
};

export type LobbyCluster = {
  event_id: string;
  university_value: string;
  university: string;
  player_count: number;
  first_joined_at: string;
};

export type LobbyPlayer = {
  id: string;
  event_id: string;
  display_name: string;
  university_value: string;
  university: string;
  joined_at: string;
  joined_late: boolean;
};

export type PostKind = 'request' | 'offer';

export type BoardPost = {
  id: string;
  event_id: string;
  player_id: string;
  criterion_id: string;
  card_square_id: string | null;
  kind: PostKind;
  status: 'open' | 'closed';
  note: string | null;
  created_at: string;
  closed_at: string | null;
  display_name: string;
  university: string;
  criterion_text: string;
  criterion_position: number;
  reply_count: number;
  last_reply_at: string | null;
};

export type BoardReply = {
  id: string;
  post_id: string;
  player_id: string;
  body: string;
  created_at: string;
  display_name: string;
  university: string;
};

export type SquareStatus = 'empty' | 'filled';
export type CriterionRule = 'honor' | 'diff_university';

export type CardSquare = {
  id: string;
  card_id: string;
  player_id: string;
  event_id: string;
  idx: number;
  criterion_id: string;
  status: SquareStatus;
  filled_by_player_id: string | null;
  filled_by_name: string | null;
  filled_by_university: string | null;
  filled_at: string | null;
  criterion_text: string;
  criterion_position: number;
  criterion_rule: CriterionRule;
};

/** A single fill, newest first — the admin live feed, and (filtered
 *  client-side by owner_id) a player's own "People I met". */
export type FillFeedRow = {
  square_id: string;
  event_id: string;
  owner_id: string;
  owner_name: string;
  criterion_id: string;
  criterion_text: string;
  criterion_position: number;
  filled_by_player_id: string | null;
  filled_by_name: string;
  filled_by_university: string;
  filled_at: string;
};

export type LeaderboardRow = {
  player_id: string;
  event_id: string;
  display_name: string;
  university: string;
  joined_late: boolean;
  bingo_at: string;
  elapsed_ms: number;
  first_line: string;
  lines_completed: number;
};

/** The second prize: most-scanned players, not capped by the pair cap. */
export type TopHelperRow = {
  event_id: string;
  player_id: string;
  display_name: string;
  university: string;
  helped_count: number;
};

export type EventStats = {
  event_id: string;
  slug: string;
  status: EventStatus;
  started_at: string | null;
  join_open: boolean;
  players_joined: number;
  cards_dealt: number;
  squares_filled: number;
  players_with_bingo: number;
  lines_completed: number;
  posts_count: number;
};

export type Criterion = {
  id: string;
  position: number;
  text: string;
  rule: CriterionRule;
};

export type StoredPlayer = {
  id: string;
  cardId: string;
  eventId: string;
  displayName: string;
  universityValue: string;
  university: string;
  joinedLate: boolean;
};

export type BoardFilter = 'all' | 'requests' | 'offers' | 'mine' | 'open';
export type BoardSort = 'newest' | 'oldest';

/** The current scan credential for the calling player. */
export type ScanCredential = {
  token: string;
  code: string;
  bucket: number;
  secondsRemaining: number;
};

export type ResolvedScan = {
  id: string;
  displayName: string;
  university: string;
};
