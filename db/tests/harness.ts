import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'db', 'migrations');

/**
 * A fresh in-memory Postgres with every migration and the seed applied.
 *
 * These tests run against real Postgres, not a mock, because the rules
 * they cover live in plpgsql. Mocking the database would test nothing.
 */
export async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create();
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith('.sql')) continue;
    try {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
  await db.exec(readFileSync(join(ROOT, 'db', 'seed.sql'), 'utf8'));
  return db;
}

export const EVENT_SLUG = 'gsg-clubs';

export type Player = {
  player_id: string;
  card_id: string;
  event_id: string;
  joined_late: boolean;
};

export async function joinPlayer(
  db: PGlite,
  name: string,
  university = 'Islamic University of Gaza',
  club = 'GDSC',
): Promise<Player> {
  const r = await db.query<{ rpc_join: Player }>(
    `select rpc_join($1,$2,$3,$4) as rpc_join`,
    [EVENT_SLUG, name, university, club],
  );
  return r.rows[0].rpc_join;
}

export async function startEvent(db: PGlite, countdownSeconds = 0) {
  await db.query(`update events set countdown_seconds = $1 where slug = $2`, [
    countdownSeconds,
    EVENT_SLUG,
  ]);
  return call(db, `rpc_admin_event($1,$2)`, [EVENT_SLUG, 'start']);
}

/** Run an RPC and return its jsonb result. */
export async function call<T = any>(db: PGlite, expr: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(`select ${expr} as out`, params);
  return (r.rows[0] as any).out as T;
}

/** Assert an RPC rejects, and return the SQLSTATE + message it rejected with. */
export async function expectError(
  fn: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await fn();
  } catch (err: any) {
    return { code: err?.code ?? '', message: err?.message ?? String(err) };
  }
  throw new Error('expected the call to be rejected, but it succeeded');
}

/** The square on a player's card carrying a given criterion position. */
export async function squareAt(db: PGlite, cardId: string, criterionPosition: number) {
  const r = await db.query<{ id: string; idx: number; status: string }>(
    `select cs.id, cs.idx, cs.status
       from card_squares cs join criteria c on c.id = cs.criterion_id
      where cs.card_id = $1 and c.position = $2`,
    [cardId, criterionPosition],
  );
  return r.rows[0];
}

/** The square at a given grid index. */
export async function squareByIdx(db: PGlite, cardId: string, idx: number) {
  const r = await db.query<{ id: string; criterion_id: string; status: string }>(
    `select id, criterion_id, status from card_squares where card_id = $1 and idx = $2`,
    [cardId, idx],
  );
  return r.rows[0];
}

/**
 * Fill a square directly, bypassing the match flow. Used only to set up
 * board states for line-detection tests — never as a substitute for
 * testing the real confirmation path.
 */
export async function forceFill(db: PGlite, squareId: string, byPlayerId: string) {
  await db.query(
    `update card_squares
        set status='filled', filled_by_player_id=$2, filled_at=now()
      where id = $1`,
    [squareId, byPlayerId],
  );
}

/**
 * Wipe gameplay state but keep the schema and criteria, so a test file
 * can share one database instead of re-running seven migrations per test.
 */
export async function resetGame(db: PGlite) {
  await db.exec(`
    delete from players;
    update events set status='waiting', started_at=null, ended_at=null,
                      paused_at=null, paused_ms=0, join_open=true, countdown_seconds=3
     where slug='${EVENT_SLUG}';
  `);
  // Re-apply the seed. Tests that exercise admin criteria edits mutate
  // rules in place, and without this the mutation leaks into every later
  // test in the file -- which is exactly how a real rule regression would
  // hide behind a green suite.
  await db.exec(readFileSync(join(ROOT, 'db', 'seed.sql'), 'utf8'));
}

/** Post a request, ask someone to vouch, and have them confirm it. */
export async function fullMatch(
  db: PGlite,
  requester: Player,
  confirmer: Player,
  criterionPosition: number,
  opts: { reciprocalSquareId?: string | null; clientKey?: string } = {},
) {
  const sq = await squareAt(db, requester.card_id, criterionPosition);
  const post = await call<{ post_id: string }>(
    db,
    `rpc_create_post($1,$2,$3,$4,$5)`,
    [requester.player_id, sq.id, 'request', null, opts.clientKey ?? `k-${sq.id}`],
  );
  const mc = await call<{ confirmation_id: string }>(
    db,
    `rpc_request_match($1,$2,$3,$4)`,
    [requester.player_id, confirmer.player_id, sq.id, post.post_id],
  );
  return call(db, `rpc_respond_match($1,$2,$3,$4)`, [
    mc.confirmation_id,
    confirmer.player_id,
    'confirm',
    opts.reciprocalSquareId ?? null,
  ]);
}

/** Run a block with a non-superuser role, for RLS tests. */
export async function asRole<T>(db: PGlite, role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}
