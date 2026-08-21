import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  freshDb, resetGame, joinPlayer, startEvent, call, squareAt, squareByIdx,
  expectError, fullMatch, forceFill, type Player,
} from './harness';

/**
 * Match confirmation — the rule that keeps the game honest. A square is
 * never self-markable, machine-checkable criteria are validated by the
 * server, and no pair may farm more than two squares off each other.
 *
 * Criterion positions used here:
 *    1 -> diff_university
 *    5 -> honor ("has a hidden talent")
 *    9 -> honor
 *   22 -> diff_club_entity
 */
const HONOR = 5;
const HONOR_2 = 9;
const DIFF_UNI = 1;
const DIFF_CLUB = 22;

describe('match confirmation', () => {
  let db: PGlite;

  beforeAll(async () => { db = await freshDb(); });
  beforeEach(async () => { await resetGame(db); });

  /** Set up N players and start the clock. */
  const setup = async (people: Array<[string, string, string]>) => {
    const players: Player[] = [];
    for (const [name, uni, club] of people) players.push(await joinPlayer(db, name, uni, club));
    await startEvent(db, 0);
    return players;
  };

  /** Get to a pending confirmation without confirming it. */
  const pendingMatch = async (requester: Player, confirmer: Player, pos: number) => {
    const sq = await squareAt(db, requester.card_id, pos);
    const post = await call<{ post_id: string }>(db, `rpc_create_post($1,$2,$3,$4,$5)`,
      [requester.player_id, sq.id, 'request', null, `ck-${sq.id}-${Math.random()}`]);
    const mc = await call<{ confirmation_id: string }>(db, `rpc_request_match($1,$2,$3,$4)`,
      [requester.player_id, confirmer.player_id, sq.id, post.post_id]);
    return { squareId: sq.id, postId: post.post_id, confirmationId: mc.confirmation_id };
  };

  const respond = (id: string, confirmerId: string, action: string, reciprocal: string | null = null) =>
    call<any>(db, `rpc_respond_match($1,$2,$3,$4)`, [id, confirmerId, action, reciprocal]);

  const squareStatus = async (squareId: string) => {
    const r = await db.query<{ status: string; filled_by_player_id: string | null }>(
      `select status, filled_by_player_id from card_squares where id = $1`, [squareId]);
    return r.rows[0];
  };

  // ------------------------------------------------------------------
  describe('a square is never self-markable', () => {
    it('refuses a match request naming yourself', async () => {
      const [a] = await setup([['Bara', 'IUG', 'GDSC']]);
      const sq = await squareAt(db, a.card_id, HONOR);
      const err = await expectError(() =>
        call(db, `rpc_request_match($1,$2,$3,$4)`, [a.player_id, a.player_id, sq.id, null]));
      expect(err.code).toBe('GB300');
      expect(err.message).toMatch(/cannot mark yourself/i);
    });

    it('the database rejects a self-match row even if the app were bypassed', async () => {
      const [a] = await setup([['Bara', 'IUG', 'GDSC']]);
      const sq = await squareAt(db, a.card_id, HONOR);
      const err = await expectError(() => db.query(
        `insert into match_confirmations
           (event_id, requester_id, confirmer_id, criterion_id, requester_square_id)
         select $1, $2, $2, criterion_id, id from card_squares where id = $3`,
        [a.event_id, a.player_id, sq.id]));
      expect(err.message).toMatch(/mc_distinct_players/);
    });

    it('a player cannot confirm a prompt addressed to someone else', async () => {
      const [a, b, c] = await setup([
        ['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE'], ['Omar', 'AUG', 'GDSC'],
      ]);
      const { confirmationId } = await pendingMatch(a, b, HONOR);
      const err = await expectError(() => respond(confirmationId, c.player_id, 'confirm'));
      expect(err.code).toBe('GB305');
      expect(err.message).toMatch(/not sent to you/i);
    });

    it('a prompt cannot be answered twice', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      const { confirmationId } = await pendingMatch(a, b, HONOR);
      await respond(confirmationId, b.player_id, 'confirm');
      const err = await expectError(() => respond(confirmationId, b.player_id, 'confirm'));
      expect(err.code).toBe('GB306');
      expect(err.message).toMatch(/already answered/i);
    });
  });

  // ------------------------------------------------------------------
  describe('the happy path', () => {
    it('fills the requester square and credits the confirmer', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      const { squareId, postId, confirmationId } = await pendingMatch(a, b, HONOR);

      expect((await squareStatus(squareId)).status).toBe('pending');

      const res = await respond(confirmationId, b.player_id, 'confirm');
      expect(res.result).toBe('confirmed');

      const sq = await squareStatus(squareId);
      expect(sq.status).toBe('filled');
      expect(sq.filled_by_player_id).toBe(b.player_id);

      const post = await db.query<{ status: string }>(
        `select status from posts where id = $1`, [postId]);
      expect(post.rows[0].status).toBe('closed');

      const pair = await db.query<{ matched_count: number }>(
        `select matched_count from pair_matches`, []);
      expect(pair.rows[0].matched_count).toBe(1);
    });

    it('declining releases the square and puts the post back on the board', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      const { squareId, postId, confirmationId } = await pendingMatch(a, b, HONOR);

      const res = await respond(confirmationId, b.player_id, 'decline');
      expect(res.result).toBe('declined');
      expect((await squareStatus(squareId)).status).toBe('empty');

      const post = await db.query<{ status: string }>(
        `select status from posts where id = $1`, [postId]);
      expect(post.rows[0].status).toBe('open');

      const pair = await db.query<{ n: number }>(
        `select coalesce(sum(matched_count),0)::int n from pair_matches`, []);
      expect(pair.rows[0].n).toBe(0);
    });

    it('the requester can cancel a pending ask and free the square', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      const { squareId, confirmationId } = await pendingMatch(a, b, HONOR);
      await call(db, `rpc_cancel_match($1,$2)`, [confirmationId, a.player_id]);
      expect((await squareStatus(squareId)).status).toBe('empty');
    });

    it('only the requester can cancel', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      const { confirmationId } = await pendingMatch(a, b, HONOR);
      const err = await expectError(() =>
        call(db, `rpc_cancel_match($1,$2)`, [confirmationId, b.player_id]));
      expect(err.code).toBe('GB305');
    });
  });

  // ------------------------------------------------------------------
  describe('criterion 1 — must be a different university', () => {
    const cases: Array<{ label: string; a: [string, string]; b: [string, string]; ok: boolean }> = [
      { label: 'same university, same club',      a: ['IUG', 'GDSC'], b: ['IUG', 'GDSC'], ok: false },
      { label: 'same university, different club', a: ['IUG', 'GDSC'], b: ['IUG', 'IEEE'], ok: false },
      { label: 'different university, same club', a: ['IUG', 'GDSC'], b: ['AUG', 'GDSC'], ok: true  },
      { label: 'different university and club',   a: ['IUG', 'GDSC'], b: ['AUG', 'IEEE'], ok: true  },
    ];

    it.each(cases)('$label -> allowed: $ok', async ({ a, b, ok }) => {
      const [pa, pb] = await setup([['Bara', ...a] as any, ['Sara', ...b] as any]);
      if (ok) {
        const res = await fullMatch(db, pa, pb, DIFF_UNI);
        expect((res as any).result).toBe('confirmed');
      } else {
        const err = await expectError(() => fullMatch(db, pa, pb, DIFF_UNI));
        expect(err.code).toBe('GB302');
        expect(err.message).toMatch(/different university/i);
      }
    });

    it('compares universities case- and whitespace-insensitively', async () => {
      const [pa, pb] = await setup([['Bara', '  islamic university  ', 'GDSC'],
                                    ['Sara', 'Islamic University',    'IEEE']]);
      const err = await expectError(() => fullMatch(db, pa, pb, DIFF_UNI));
      expect(err.code).toBe('GB302');
    });
  });

  // ------------------------------------------------------------------
  describe('criterion 22 — must be a different club, where a club is (university, club)', () => {
    const cases: Array<{ label: string; a: [string, string]; b: [string, string]; ok: boolean }> = [
      { label: 'identical club at the same university', a: ['IUG', 'IEEE'], b: ['IUG', 'IEEE'], ok: false },
      { label: 'different clubs at the same university', a: ['IUG', 'GDSC'], b: ['IUG', 'IEEE'], ok: true },
      { label: 'same club name at different universities', a: ['IUG', 'IEEE'], b: ['AUG', 'IEEE'], ok: true },
      { label: 'different everything', a: ['IUG', 'GDSC'], b: ['AUG', 'IEEE'], ok: true },
    ];

    it.each(cases)('$label -> allowed: $ok', async ({ a, b, ok }) => {
      const [pa, pb] = await setup([['Bara', ...a] as any, ['Sara', ...b] as any]);
      if (ok) {
        const res = await fullMatch(db, pa, pb, DIFF_CLUB);
        expect((res as any).result).toBe('confirmed');
      } else {
        const err = await expectError(() => fullMatch(db, pa, pb, DIFF_CLUB));
        expect(err.code).toBe('GB303');
        expect(err.message).toMatch(/different club/i);
      }
    });
  });

  it('honour-system criteria are never blocked, even for identical players', async () => {
    const [pa, pb] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'IUG', 'GDSC']]);
    const res = await fullMatch(db, pa, pb, HONOR);
    expect((res as any).result).toBe('confirmed');
  });

  it('re-validates the rule at confirmation time, not only when asking', async () => {
    // An admin can edit a criterion mid-event. A confirmation created
    // under the old rule must not sail through under the new one.
    const [pa, pb] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'IUG', 'GDSC']]);
    const { confirmationId } = await pendingMatch(pa, pb, HONOR);

    await db.query(
      `update criteria set rule = 'diff_university' where position = $1 and event_id = $2`,
      [HONOR, pa.event_id]);

    const err = await expectError(() => respond(confirmationId, pb.player_id, 'confirm'));
    expect(err.code).toBe('GB302');
  });

  // ------------------------------------------------------------------
  describe('the two-squares-per-pair cap', () => {
    it('allows two matches then refuses the third', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      await fullMatch(db, a, b, HONOR);
      await fullMatch(db, a, b, HONOR_2);

      const err = await expectError(() => fullMatch(db, a, b, 12));
      expect(err.code).toBe('GB301');
      expect(err.message).toMatch(/already matched twice/i);
    });

    it('counts matches in both directions', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      await fullMatch(db, a, b, HONOR);       // a's square, b vouches
      await fullMatch(db, b, a, HONOR_2);     // b's square, a vouches

      const err = await expectError(() => fullMatch(db, a, b, 12));
      expect(err.code).toBe('GB301');

      const pair = await db.query<{ matched_count: number }>(`select matched_count from pair_matches`);
      expect(pair.rows[0].matched_count).toBe(2);
    });

    it('does not restrict matches with different people', async () => {
      const [a, b, c] = await setup([
        ['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE'], ['Omar', 'AUG', 'GDSC'],
      ]);
      await fullMatch(db, a, b, HONOR);
      await fullMatch(db, a, b, HONOR_2);
      await expect(fullMatch(db, a, c, 12)).resolves.toBeTruthy();
    });

    it('is backed by a database CHECK, not only by the RPC', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      await fullMatch(db, a, b, HONOR);
      const err = await expectError(() => db.query(`update pair_matches set matched_count = 3`));
      expect(err.message).toMatch(/pair_matches_matched_count_check|violates check/i);
    });
  });

  // ------------------------------------------------------------------
  describe('the reciprocal "fill my matching square too" option', () => {
    it('fills the square the confirmer picks, and nothing else', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      const mine = await squareAt(db, b.card_id, HONOR_2);
      const { confirmationId } = await pendingMatch(a, b, HONOR);

      const res = await respond(confirmationId, b.player_id, 'confirm', mine.id);
      expect(res.reciprocal_filled).toBe(true);

      const sq = await squareStatus(mine.id);
      expect(sq.status).toBe('filled');
      expect(sq.filled_by_player_id).toBe(a.player_id);

      const filled = await db.query<{ n: number }>(
        `select count(*)::int n from card_squares where status='filled'`);
      expect(filled.rows[0].n).toBe(2);
    });

    it('consumes the pair budget, so the pair is then used up', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      const mine = await squareAt(db, b.card_id, HONOR_2);
      const { confirmationId } = await pendingMatch(a, b, HONOR);
      await respond(confirmationId, b.player_id, 'confirm', mine.id);

      const pair = await db.query<{ matched_count: number }>(`select matched_count from pair_matches`);
      expect(pair.rows[0].matched_count).toBe(2);

      const err = await expectError(() => fullMatch(db, a, b, 12));
      expect(err.code).toBe('GB301');
    });

    it('completes the main match but skips the extra when the budget only has room for one', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      await fullMatch(db, a, b, HONOR);                   // pair budget now 1 of 2

      const mine = await squareAt(db, b.card_id, HONOR_2);
      const { squareId, confirmationId } = await pendingMatch(a, b, 12);
      const res = await respond(confirmationId, b.player_id, 'confirm', mine.id);

      expect(res.result).toBe('confirmed');
      expect(res.reciprocal_filled).toBe(false);
      expect(res.note).toMatch(/not filled/i);
      expect((await squareStatus(squareId)).status).toBe('filled');
      expect((await squareStatus(mine.id)).status).toBe('empty');
    });

    it('refuses a square that is not on the confirmer card', async () => {
      const [a, b, c] = await setup([
        ['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE'], ['Omar', 'AUG', 'GDSC'],
      ]);
      const notMine = await squareAt(db, c.card_id, HONOR_2);
      const { confirmationId } = await pendingMatch(a, b, HONOR);
      const err = await expectError(() => respond(confirmationId, b.player_id, 'confirm', notMine.id));
      expect(err.code).toBe('GB403');
      expect(err.message).toMatch(/not on your card/i);
    });

    it('validates machine-checkable rules in the reversed direction', async () => {
      // Same university: the confirmer must not be able to claim
      // criterion 1 off the very person they share a university with.
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'IUG', 'IEEE']]);
      const mine = await squareAt(db, b.card_id, DIFF_UNI);
      const { confirmationId } = await pendingMatch(a, b, HONOR);
      const err = await expectError(() => respond(confirmationId, b.player_id, 'confirm', mine.id));
      expect(err.code).toBe('GB302');
    });

    it('can complete a line for the confirmer and award them a BINGO', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      // fill four of b's row 0 directly, leave the fifth for the reciprocal
      for (const idx of [0, 1, 2, 3]) {
        const sq = await squareByIdx(db, b.card_id, idx);
        await forceFill(db, sq.id, a.player_id);
      }
      const last = await squareByIdx(db, b.card_id, 4);
      const { confirmationId } = await pendingMatch(a, b, HONOR);
      const res = await respond(confirmationId, b.player_id, 'confirm', last.id);

      expect(res.reciprocal_filled).toBe(true);
      expect(res.reciprocal_lines).toEqual(['row:0']);
    });
  });

  // ------------------------------------------------------------------
  describe('races and stale state', () => {
    it('allows only one pending confirmation per square', async () => {
      const [a, b, c] = await setup([
        ['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE'], ['Omar', 'AUG', 'GDSC'],
      ]);
      const { squareId } = await pendingMatch(a, b, HONOR);
      const err = await expectError(() =>
        call(db, `rpc_request_match($1,$2,$3,$4)`, [a.player_id, c.player_id, squareId, null]));
      expect(err.code).toBe('GB403');
      expect(err.message).toMatch(/already have a match waiting/i);
    });

    it('refuses to confirm into a square that got filled in the meantime', async () => {
      const [a, b, c] = await setup([
        ['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE'], ['Omar', 'AUG', 'GDSC'],
      ]);
      const { squareId, confirmationId } = await pendingMatch(a, b, HONOR);
      await forceFill(db, squareId, c.player_id);   // someone else got there first

      const err = await expectError(() => respond(confirmationId, b.player_id, 'confirm'));
      expect(err.code).toBe('GB304');
      expect(err.message).toMatch(/already filled/i);
    });

    it('refuses a match request for a square that is already filled', async () => {
      const [a, b, c] = await setup([
        ['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE'], ['Omar', 'AUG', 'GDSC'],
      ]);
      const sq = await squareAt(db, a.card_id, HONOR);
      await forceFill(db, sq.id, c.player_id);
      const err = await expectError(() =>
        call(db, `rpc_request_match($1,$2,$3,$4)`, [a.player_id, b.player_id, sq.id, null]));
      expect(err.code).toBe('GB304');
    });

    it('rejects a confirmation from a player the admin has removed', async () => {
      const [a, b] = await setup([['Bara', 'IUG', 'GDSC'], ['Sara', 'AUG', 'IEEE']]);
      const { confirmationId } = await pendingMatch(a, b, HONOR);
      await db.query(`update players set removed_at = now() where id = $1`, [b.player_id]);
      const err = await expectError(() => respond(confirmationId, b.player_id, 'confirm'));
      expect(err.code).toBe('GB400');
    });
  });
});
