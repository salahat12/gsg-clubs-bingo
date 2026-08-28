import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  freshDb, resetGame, joinPlayer, startEvent, call, squareAt, squareByIdx,
  expectError, scanFill, forceFill, type Player,
} from './harness';

/**
 * The scan-fill rule — the game's only mechanism for filling a square now.
 * A square is never self-fillable, machine-checkable criteria are
 * validated server-side, no pair may farm more than two squares off each
 * other, and a retried request never double-fills or double-spends the
 * pair budget.
 *
 * Criterion positions used here (see db/seed.sql):
 *    4  -> diff_university
 *    5  -> honor
 *    9  -> honor
 */
const HONOR = 5;
const HONOR_2 = 9;
const DIFF_UNI = 4;

describe('scan fill', () => {
  let db: PGlite;

  beforeAll(async () => { db = await freshDb(); });
  beforeEach(async () => { await resetGame(db); });

  const setup = async (
    people: Array<{ name: string; university?: string }>,
  ) => {
    const players: Player[] = [];
    for (const p of people) players.push(await joinPlayer(db, p.name, p));
    await startEvent(db, 0);
    return players;
  };

  const squareStatus = async (squareId: string) => {
    const r = await db.query<{ status: string; filled_by_player_id: string | null }>(
      `select status, filled_by_player_id from card_squares where id = $1`, [squareId]);
    return r.rows[0];
  };

  // ------------------------------------------------------------------
  describe('a square is never self-fillable', () => {
    it('refuses scanning your own code', async () => {
      const [a] = await setup([{ name: 'Bara' }]);
      const sq = await squareAt(db, a.card_id, HONOR);
      const err = await expectError(() => scanFill(db, a, a, HONOR));
      expect(err.code).toBe('GB300');
      expect(err.message).toMatch(/cannot scan your own code/i);
      expect((await squareStatus(sq.id)).status).toBe('empty');
    });
  });

  // ------------------------------------------------------------------
  describe('the happy path', () => {
    it('fills the square and stamps who filled it', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      const sq = await squareAt(db, a.card_id, HONOR);

      const res: any = await scanFill(db, a, b, HONOR);
      expect(res.result).toBe('filled');
      expect(res.scanned_name).toBe('Sara');

      const row = await db.query<{
        status: string; filled_by_player_id: string; filled_by_name: string; filled_by_university: string;
      }>(`select status, filled_by_player_id, filled_by_name, filled_by_university
            from card_squares where id = $1`, [sq.id]);
      expect(row.rows[0].status).toBe('filled');
      expect(row.rows[0].filled_by_player_id).toBe(b.player_id);
      expect(row.rows[0].filled_by_name).toBe('Sara');
      expect(row.rows[0].filled_by_university).toContain('Hebron');

      const pair = await db.query<{ matched_count: number }>(`select matched_count from pair_matches`);
      expect(pair.rows[0].matched_count).toBe(1);
    });

    it('does not touch the scanned player\'s own card', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      await scanFill(db, a, b, HONOR);
      const filled = await db.query<{ n: number }>(
        `select count(*)::int n from card_squares cs join cards c on c.id = cs.card_id
          where c.player_id = $1 and cs.status = 'filled'`, [b.player_id]);
      expect(filled.rows[0].n).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  describe('criterion 4 — must be a different university', () => {
    it('rejects when both are from the same university', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara' }]); // both default 'aqu'
      const err = await expectError(() => scanFill(db, a, b, DIFF_UNI));
      expect(err.code).toBe('GB302');
      expect(err.message).toMatch(/different university/i);
    });

    it('allows different universities', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      const res: any = await scanFill(db, a, b, DIFF_UNI);
      expect(res.result).toBe('filled');
    });

    it('Rihan and Jenin AAUP campuses count as different universities', async () => {
      const [a, b] = await setup([
        { name: 'Bara', university: 'aaup_rihan' },
        { name: 'Sara', university: 'aaup_jenin' },
      ]);
      const res: any = await scanFill(db, a, b, DIFF_UNI);
      expect(res.result).toBe('filled');
    });

    it('every "Other" is its own university, so two Others match', async () => {
      const [a, b] = await setup([
        { name: 'Bara', university: 'other' }, { name: 'Sara', university: 'other' },
      ]);
      const res: any = await scanFill(db, a, b, DIFF_UNI);
      expect(res.result).toBe('filled');
    });
  });

  it('criterion 7 ("was in the previous scholarship") is honor system, not server-checked', async () => {
    // Every attendee is the same cohort — there is no player fact to
    // verify, so this passes exactly like any other honour-system square.
    const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara' }]);
    const res: any = await scanFill(db, a, b, 7);
    expect(res.result).toBe('filled');
  });

  it('honour-system criteria are never blocked, even for identical players', async () => {
    const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara' }]);
    const res: any = await scanFill(db, a, b, HONOR);
    expect(res.result).toBe('filled');
  });

  it('re-validates the rule at fill time, not only from stale client state', async () => {
    const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara' }]);
    await db.query(
      `update criteria set rule = 'diff_university' where position = $1 and event_id = $2`,
      [HONOR, a.event_id]);
    const err = await expectError(() => scanFill(db, a, b, HONOR));
    expect(err.code).toBe('GB302');
  });

  // ------------------------------------------------------------------
  describe('the two-squares-per-pair cap', () => {
    it('allows two fills then refuses the third', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      await scanFill(db, a, b, HONOR);
      await scanFill(db, a, b, HONOR_2);

      const err = await expectError(() => scanFill(db, a, b, 12));
      expect(err.code).toBe('GB301');
      expect(err.message).toMatch(/already matched with sara twice/i);
    });

    it('counts fills in both directions', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      await scanFill(db, a, b, HONOR);       // a's square, scans b
      await scanFill(db, b, a, HONOR_2);     // b's square, scans a

      const err = await expectError(() => scanFill(db, a, b, 12));
      expect(err.code).toBe('GB301');

      const pair = await db.query<{ matched_count: number }>(`select matched_count from pair_matches`);
      expect(pair.rows[0].matched_count).toBe(2);
    });

    it('does not restrict fills with different people', async () => {
      const [a, b, c] = await setup([
        { name: 'Bara' }, { name: 'Sara', university: 'hu' }, { name: 'Omar', university: 'hu' },
      ]);
      await scanFill(db, a, b, HONOR);
      await scanFill(db, a, b, HONOR_2);
      await expect(scanFill(db, a, c, 12)).resolves.toBeTruthy();
    });

    it('is backed by a database CHECK, not only by the RPC', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      await scanFill(db, a, b, HONOR);
      const err = await expectError(() => db.query(`update pair_matches set matched_count = 3`));
      expect(err.message).toMatch(/pair_matches_matched_count_check|violates check/i);
    });

    it('undo refunds the pair cap slot', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      const sq = await squareAt(db, a.card_id, HONOR);
      await scanFill(db, a, b, HONOR);
      await scanFill(db, a, b, HONOR_2);

      await call(db, `rpc_admin_undo_square($1)`, [sq.id]);
      const pair = await db.query<{ matched_count: number }>(`select matched_count from pair_matches`);
      expect(pair.rows[0].matched_count).toBe(1);

      // the freed slot is usable again
      await expect(scanFill(db, a, b, 12)).resolves.toBeTruthy();
    });
  });

  // ------------------------------------------------------------------
  describe('idempotency', () => {
    it('a retried scan with the same client key replays the same result, not a second fill', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      const sq = await squareAt(db, a.card_id, HONOR);

      const first: any = await call(db, `rpc_scan_fill($1,$2,$3,$4)`,
        [a.player_id, sq.id, b.player_id, 'retry-key']);
      const again: any = await call(db, `rpc_scan_fill($1,$2,$3,$4)`,
        [a.player_id, sq.id, b.player_id, 'retry-key']);

      expect(again).toEqual(first);
      const pair = await db.query<{ matched_count: number }>(`select matched_count from pair_matches`);
      expect(pair.rows[0].matched_count).toBe(1);
    });

    it('a different client key for an already-filled square is rejected normally', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      const sq = await squareAt(db, a.card_id, HONOR);
      await call(db, `rpc_scan_fill($1,$2,$3,$4)`, [a.player_id, sq.id, b.player_id, 'key-1']);
      const err = await expectError(() =>
        call(db, `rpc_scan_fill($1,$2,$3,$4)`, [a.player_id, sq.id, b.player_id, 'key-2']));
      expect(err.code).toBe('GB304');
    });
  });

  // ------------------------------------------------------------------
  describe('rate limiting on the resolve/preview path', () => {
    it('caps at 10 attempts per minute and keeps the message actionable', async () => {
      const [a] = await setup([{ name: 'Bara' }]);
      for (let i = 0; i < 10; i++) {
        await call(db, `rpc_assert_scan_resolve_rate($1)`, [a.player_id]);
      }
      const err = await expectError(() => call(db, `rpc_assert_scan_resolve_rate($1)`, [a.player_id]));
      expect(err.code).toBe('GB200');
      expect(err.message).toMatch(/too fast/i);
    });

    it('does not share a budget with scan_fill\'s own rate limit', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      for (let i = 0; i < 10; i++) {
        await call(db, `rpc_assert_scan_resolve_rate($1)`, [a.player_id]);
      }
      // resolve is maxed out, but an actual fill is a different rate bucket
      await expect(scanFill(db, a, b, HONOR)).resolves.toBeTruthy();
    });
  });

  // ------------------------------------------------------------------
  describe('races and stale state', () => {
    it('refuses to fill a square someone else already filled', async () => {
      const [a, b, c] = await setup([
        { name: 'Bara' }, { name: 'Sara', university: 'hu' }, { name: 'Omar', university: 'hu' },
      ]);
      const sq = await squareAt(db, a.card_id, HONOR);
      await forceFill(db, sq.id, c.player_id);
      const err = await expectError(() => scanFill(db, a, b, HONOR));
      expect(err.code).toBe('GB304');
    });

    it('rejects a scan naming a player the admin has removed', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      await db.query(`update players set removed_at = now() where id = $1`, [b.player_id]);
      const err = await expectError(() => scanFill(db, a, b, HONOR));
      expect(err.code).toBe('GB400');
    });

    it('can complete a line and award a BINGO', async () => {
      const [a, b] = await setup([{ name: 'Bara' }, { name: 'Sara', university: 'hu' }]);
      for (const idx of [0, 1, 2, 3]) {
        const sq = await squareByIdx(db, a.card_id, idx);
        await forceFill(db, sq.id, b.player_id);
      }
      const last = await squareByIdx(db, a.card_id, 4);
      const cr = await db.query<{ position: number }>(
        `select position from criteria where id = (select criterion_id from card_squares where id = $1)`,
        [last.id]);
      const res: any = await scanFill(db, a, b, cr.rows[0].position);
      expect(res.new_lines).toEqual(['row:0']);
    });
  });
});
