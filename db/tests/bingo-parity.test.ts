import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, joinPlayer, startEvent, call } from './harness';
import { completeLines, LINES } from '../../src/lib/bingo';

/**
 * The card renders a line the instant it completes, using a TypeScript
 * copy of the line rules, while the server independently decides who
 * actually gets the BINGO. If those two ever disagree, a player sees a
 * celebration that never lands on the leaderboard — or worse, misses one
 * that does. This test makes the two implementations prove they agree.
 */
describe('client and server agree on what a line is', () => {
  let db: PGlite;
  let cardId: string;
  let byPlayer: string;

  beforeAll(async () => {
    db = await freshDb();
    const a = await joinPlayer(db, 'Bara', { university: 'aqu' });
    const b = await joinPlayer(db, 'Sara', { university: 'hu' });
    await startEvent(db, 0);
    cardId = a.card_id;
    byPlayer = b.player_id;
  });

  const applyPattern = async (filled: boolean[]) => {
    const idxs = filled.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
    await db.query(
      `update card_squares
          set status='empty', filled_at=null, filled_by_player_id=null,
              filled_by_name=null, filled_by_university=null
        where card_id = $1`, [cardId]);
    if (idxs.length) {
      await db.query(
        `update card_squares
            set status='filled', filled_at=now(), filled_by_player_id=$2,
                filled_by_name='Sara', filled_by_university='Test University'
          where card_id = $1 and idx = any($3::int[])`, [cardId, byPlayer, idxs]);
    }
    return ((await call<string[]>(db, `complete_lines($1)`, [cardId])) ?? []).slice().sort();
  };

  it('exposes the same 12 lines on both sides', async () => {
    const full = Array(25).fill(true);
    const sql = await applyPattern(full);
    expect(LINES).toHaveLength(12);
    expect(completeLines(full).slice().sort()).toEqual(sql);
  });

  it('agrees on every single-line pattern', async () => {
    for (const line of LINES) {
      const filled = Array(25).fill(false);
      line.idxs.forEach((i) => (filled[i] = true));
      const sql = await applyPattern(filled);
      expect(sql, `SQL should see exactly ${line.key}`).toEqual([line.key]);
      expect(completeLines(filled).slice().sort()).toEqual(sql);
    }
  });

  it('agrees on 250 pseudo-random boards', async () => {
    // deterministic LCG so a failure is reproducible
    let seed = 0x2545f491;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000;

    let boardsWithLines = 0;
    for (let n = 0; n < 250; n++) {
      // vary density so we get both sparse boards and near-full ones
      const density = 0.25 + (n / 250) * 0.7;
      const filled = Array.from({ length: 25 }, () => next() < density);

      const sql = await applyPattern(filled);
      const ts = completeLines(filled).slice().sort();
      expect(ts, `mismatch on board ${JSON.stringify(filled)}`).toEqual(sql);
      if (sql.length) boardsWithLines++;
    }
    // guard against the test passing because nothing ever completed
    expect(boardsWithLines).toBeGreaterThan(20);
  });
});
