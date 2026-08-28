import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  freshDb, resetGame, joinPlayer, startEvent, call, squareByIdx, forceFill, scanFill,
  type Player,
} from './harness';

/**
 * BINGO line detection. The grid is idx 0..24, row-major:
 *
 *    0  1  2  3  4
 *    5  6  7  8  9
 *   10 11 12 13 14
 *   15 16 17 18 19
 *   20 21 22 23 24
 *
 * There is no free centre square, so every line is five real confirmed
 * matches.
 */

const ROWS = [0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c));
const COLS = [0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c));
const DIAG0 = [0, 6, 12, 18, 24];
const DIAG1 = [4, 8, 12, 16, 20];

const ALL_LINES: Array<{ key: string; idxs: number[] }> = [
  ...ROWS.map((idxs, i) => ({ key: `row:${i}`, idxs })),
  ...COLS.map((idxs, i) => ({ key: `col:${i}`, idxs })),
  { key: 'diag:0', idxs: DIAG0 },
  { key: 'diag:1', idxs: DIAG1 },
];

describe('BINGO line detection', () => {
  let db: PGlite;
  let me: Player;
  let other: Player;

  beforeAll(async () => {
    db = await freshDb();
  });

  beforeEach(async () => {
    await resetGame(db);
    me = await joinPlayer(db, 'Bara', { university: 'aqu' });
    other = await joinPlayer(db, 'Sara', { university: 'hu' });
    await startEvent(db, 0);
  });

  const lines = async (cardId: string) =>
    (await call<string[]>(db, `complete_lines($1)`, [cardId])) ?? [];

  const fill = async (idxs: number[]) => {
    for (const idx of idxs) {
      const sq = await squareByIdx(db, me.card_id, idx);
      await forceFill(db, sq.id, other.player_id);
    }
  };

  it('finds no line on an empty card', async () => {
    expect(await lines(me.card_id)).toEqual([]);
  });

  it.each(ALL_LINES)('detects $key when exactly its five squares are filled', async ({ key, idxs }) => {
    await fill(idxs);
    expect(await lines(me.card_id)).toEqual([key]);
  });

  it.each(ALL_LINES)('does NOT detect $key with only four of five filled', async ({ idxs }) => {
    await fill(idxs.slice(0, 4));
    expect(await lines(me.card_id)).toEqual([]);
  });

  it('detects both diagonals at once without double-counting the shared centre', async () => {
    await fill([...new Set([...DIAG0, ...DIAG1])]);
    const got = await lines(me.card_id);
    expect(got.sort()).toEqual(['diag:0', 'diag:1']);
  });

  it('detects a row and a column that intersect', async () => {
    await fill([...new Set([...ROWS[2], ...COLS[3]])]);
    expect((await lines(me.card_id)).sort()).toEqual(['col:3', 'row:2']);
  });

  it('detects all 12 lines on a full card', async () => {
    await fill([...Array(25).keys()]);
    const got = await lines(me.card_id);
    expect(got).toHaveLength(12);
    expect(got.sort()).toEqual(ALL_LINES.map((l) => l.key).sort());
  });

  it('a scattered 12 squares with no complete line yields nothing', async () => {
    // deliberately breaks every row, column and diagonal
    await fill([0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 13, 15]);
    expect(await lines(me.card_id)).toEqual([]);
  });

  describe('record_bingos', () => {
    it('awards a line once and returns only newly completed lines', async () => {
      await fill(ROWS[0]);
      const first = await call<string[]>(db, `record_bingos($1)`, [me.player_id]);
      expect(first).toEqual(['row:0']);

      // running again awards nothing new
      const second = await call<string[]>(db, `record_bingos($1)`, [me.player_id]);
      expect(second).toEqual([]);

      const n = await db.query<{ n: number }>(
        `select count(*)::int n from bingos where player_id = $1`, [me.player_id],
      );
      expect(n.rows[0].n).toBe(1);
    });

    it('returns only the second line when another completes later', async () => {
      await fill(ROWS[0]);
      await call(db, `record_bingos($1)`, [me.player_id]);
      await fill(ROWS[1]);
      expect(await call<string[]>(db, `record_bingos($1)`, [me.player_id])).toEqual(['row:1']);
    });

    it('stamps elapsed_ms from the event start, not from when the player joined', async () => {
      // push started_at 10s into the past, so elapsed should be ~10s
      await db.exec(`update events set started_at = now() - interval '10 seconds'`);
      await fill(ROWS[0]);
      await call(db, `record_bingos($1)`, [me.player_id]);
      const r = await db.query<{ elapsed_ms: string }>(
        `select elapsed_ms from bingos where player_id = $1`, [me.player_id],
      );
      const ms = Number(r.rows[0].elapsed_ms);
      expect(ms).toBeGreaterThan(9_000);
      expect(ms).toBeLessThan(12_000);
    });

    it('subtracts paused time from elapsed_ms', async () => {
      await db.exec(`update events set started_at = now() - interval '10 seconds', paused_ms = 4000`);
      await fill(ROWS[0]);
      await call(db, `record_bingos($1)`, [me.player_id]);
      const r = await db.query<{ elapsed_ms: string }>(
        `select elapsed_ms from bingos where player_id = $1`, [me.player_id],
      );
      const ms = Number(r.rows[0].elapsed_ms);
      expect(ms).toBeGreaterThan(5_000);
      expect(ms).toBeLessThan(8_000);
    });
  });

  it('a real scan completing a line records the BINGO through the RPC', async () => {
    // fill four squares of row 0 directly, then win the fifth for real
    const row0 = ROWS[0];
    await fill(row0.slice(0, 4));

    const lastSquare = await squareByIdx(db, me.card_id, row0[4]);
    const pos = await db.query<{ position: number }>(
      `select position from criteria where id = $1`, [lastSquare.criterion_id],
    );

    const result = await scanFill(db, me, other, pos.rows[0].position);
    expect((result as any).result).toBe('filled');
    expect((result as any).new_lines).toEqual(['row:0']);

    const b = await db.query<{ n: number }>(
      `select count(*)::int n from bingos where player_id = $1`, [me.player_id],
    );
    expect(b.rows[0].n).toBe(1);
  });
});
