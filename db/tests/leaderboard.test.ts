import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  freshDb, resetGame, joinPlayer, startEvent, call, squareByIdx, forceFill, type Player,
} from './harness';

describe('leaderboard', () => {
  let db: PGlite;

  beforeAll(async () => { db = await freshDb(); });
  beforeEach(async () => { await resetGame(db); });

  /** Complete `line` for a player and award it at a given elapsed offset. */
  const winLine = async (p: Player, idxs: number[], secondsAgoStarted: number) => {
    await db.exec(`update events set started_at = now() - interval '${secondsAgoStarted} seconds'`);
    for (const idx of idxs) {
      const sq = await squareByIdx(db, p.card_id, idx);
      await forceFill(db, sq.id, p.player_id);
    }
    return call<string[]>(db, `record_bingos($1)`, [p.player_id]);
  };

  const board = async () => {
    const r = await db.query(
      `select display_name, university, club, elapsed_ms, lines_completed, joined_late
         from v_leaderboard order by elapsed_ms asc`);
    return r.rows as any[];
  };

  const ROW = (r: number) => [0, 1, 2, 3, 4].map((c) => r * 5 + c);

  it('lists a player once, at their first BINGO', async () => {
    const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
    await startEvent(db, 0);

    await winLine(a, ROW(0), 30);
    await winLine(a, ROW(1), 60);

    const rows = await board();
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe('Bara');
    expect(rows[0].lines_completed).toBe(2);
    expect(Number(rows[0].elapsed_ms)).toBeLessThan(35_000);
  });

  it('ranks by elapsed time from the event start, not by join order', async () => {
    const slow = await joinPlayer(db, 'Slow', 'IUG', 'GDSC');
    const fast = await joinPlayer(db, 'Fast', 'AUG', 'IEEE');
    await startEvent(db, 0);

    await winLine(slow, ROW(0), 300);   // 5 minutes in
    await winLine(fast, ROW(0), 45);    // 45 seconds in

    const rows = await board();
    expect(rows.map((r) => r.display_name)).toEqual(['Fast', 'Slow']);
  });

  it('measures a late joiner from the event start and flags them', async () => {
    const early = await joinPlayer(db, 'Early', 'IUG', 'GDSC');
    await startEvent(db, 0);
    const late = await joinPlayer(db, 'Late', 'AUG', 'IEEE');

    expect(early.joined_late).toBe(false);
    expect(late.joined_late).toBe(true);

    await winLine(late, ROW(0), 200);
    const rows = await board();
    expect(rows[0].display_name).toBe('Late');
    expect(rows[0].joined_late).toBe(true);
    expect(Number(rows[0].elapsed_ms)).toBeGreaterThan(190_000);
  });

  it('drops a player the admin removed', async () => {
    const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
    const b = await joinPlayer(db, 'Sara', 'AUG', 'IEEE');
    await startEvent(db, 0);
    await winLine(a, ROW(0), 30);
    await winLine(b, ROW(1), 40);

    expect(await board()).toHaveLength(2);
    await call(db, `rpc_admin_remove_player($1)`, [a.player_id]);
    const rows = await board();
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe('Sara');
  });

  it('uses later lines as the tiebreak column without reordering the first BINGO', async () => {
    const a = await joinPlayer(db, 'A', 'IUG', 'GDSC');
    const b = await joinPlayer(db, 'B', 'AUG', 'IEEE');
    await startEvent(db, 0);

    await winLine(a, ROW(0), 20);
    await winLine(b, ROW(0), 25);
    await winLine(b, ROW(1), 30);   // B racks up more lines but was slower to the first

    const rows = await board();
    expect(rows.map((r) => r.display_name)).toEqual(['A', 'B']);
    expect(rows[0].lines_completed).toBe(1);
    expect(rows[1].lines_completed).toBe(2);
  });
});
