import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  freshDb, resetGame, joinPlayer, startEvent, call, squareAt, expectError,
  EVENT_SLUG, type Player,
} from './harness';

/**
 * The start gate. Nobody plays until the admin presses Start, and this is
 * enforced in the database — not by hiding the UI. Every one of these
 * calls is the raw RPC, i.e. what an attacker with the service key's
 * surface area would reach.
 *
 * Note the countdown case: on Start the status flips to 'running'
 * immediately so every client can render 3-2-1, but started_at is a few
 * seconds in the future and writes stay rejected until it passes. That is
 * what makes the race start fair.
 */
describe('start gate', () => {
  let db: PGlite;
  let a: Player;
  let b: Player;

  beforeAll(async () => { db = await freshDb(); });

  beforeEach(async () => {
    await resetGame(db);
    a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
    b = await joinPlayer(db, 'Sara', 'AUG', 'IEEE');
  });

  /** Every player-facing write, as a callable, for table-driven testing. */
  const writes = () => [
    {
      name: 'post to the board',
      run: async () => {
        const sq = await squareAt(db, a.card_id, 3);
        return call(db, `rpc_create_post($1,$2,$3,$4,$5)`,
          [a.player_id, sq.id, 'request', null, `ck-${Math.random()}`]);
      },
    },
    {
      name: 'ask someone to vouch',
      run: async () => {
        const sq = await squareAt(db, a.card_id, 3);
        return call(db, `rpc_request_match($1,$2,$3,$4)`,
          [a.player_id, b.player_id, sq.id, null]);
      },
    },
  ];

  describe('while the event is waiting', () => {
    it.each(writes())('rejects: $name', async ({ run }) => {
      const err = await expectError(run);
      expect(err.code).toBe('GB100');
      expect(err.message).toMatch(/has not started yet/i);
    });

    it('still allows joining, so people can fill the lobby', async () => {
      const p = await joinPlayer(db, 'Late', 'IUG', 'IEEE');
      expect(p.player_id).toBeTruthy();
    });
  });

  describe('during the 3-2-1 countdown', () => {
    beforeEach(async () => { await startEvent(db, 3); });

    it('has already flipped status to running so clients can show the countdown', async () => {
      const r = await db.query<{ status: string; ahead: boolean }>(
        `select status, started_at > now() as ahead from events where slug = $1`, [EVENT_SLUG],
      );
      expect(r.rows[0].status).toBe('running');
      expect(r.rows[0].ahead).toBe(true);
    });

    it.each(writes())('still rejects: $name', async ({ run }) => {
      const err = await expectError(run);
      expect(err.code).toBe('GB103');
      expect(err.message).toMatch(/countdown/i);
    });
  });

  describe('once the countdown has passed', () => {
    beforeEach(async () => { await startEvent(db, 0); });

    it.each(writes())('allows: $name', async ({ run }) => {
      await expect(run()).resolves.toBeTruthy();
    });
  });

  describe('while paused', () => {
    beforeEach(async () => {
      await startEvent(db, 0);
      await call(db, `rpc_admin_event($1,$2)`, [EVENT_SLUG, 'pause']);
    });

    it.each(writes())('rejects: $name', async ({ run }) => {
      const err = await expectError(run);
      expect(err.code).toBe('GB101');
      expect(err.message).toMatch(/paused/i);
    });

    it('resumes cleanly and banks the paused time', async () => {
      await call(db, `rpc_admin_event($1,$2)`, [EVENT_SLUG, 'resume']);
      const r = await db.query<{ status: string; paused_ms: string; paused_at: string | null }>(
        `select status, paused_ms, paused_at from events where slug = $1`, [EVENT_SLUG],
      );
      expect(r.rows[0].status).toBe('running');
      expect(r.rows[0].paused_at).toBeNull();
      expect(Number(r.rows[0].paused_ms)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('after the event ends', () => {
    beforeEach(async () => {
      await startEvent(db, 0);
      await call(db, `rpc_admin_event($1,$2)`, [EVENT_SLUG, 'end']);
    });

    it.each(writes())('rejects: $name', async ({ run }) => {
      const err = await expectError(run);
      expect(err.code).toBe('GB102');
      expect(err.message).toMatch(/ended/i);
    });

    it('refuses new joins', async () => {
      const err = await expectError(() => joinPlayer(db, 'TooLate', 'IUG', 'GDSC'));
      expect(err.code).toBe('GB102');
    });
  });

  describe('joining', () => {
    it('is refused once the admin closes it', async () => {
      await call(db, `rpc_admin_event($1,$2)`, [EVENT_SLUG, 'close_join']);
      const err = await expectError(() => joinPlayer(db, 'Nope', 'IUG', 'GDSC'));
      expect(err.code).toBe('GB104');
      expect(err.message).toMatch(/joining is closed/i);
    });

    it('reopens when the admin reopens it', async () => {
      await call(db, `rpc_admin_event($1,$2)`, [EVENT_SLUG, 'close_join']);
      await call(db, `rpc_admin_event($1,$2)`, [EVENT_SLUG, 'open_join']);
      await expect(joinPlayer(db, 'Yes', 'IUG', 'GDSC')).resolves.toBeTruthy();
    });

    it('marks mid-race arrivals as late joiners', async () => {
      await startEvent(db, 0);
      const late = await joinPlayer(db, 'Latecomer', 'IUG', 'IEEE');
      expect(late.joined_late).toBe(true);

      const early = await db.query<{ joined_late: boolean }>(
        `select joined_late from players where id = $1`, [a.player_id],
      );
      expect(early.rows[0].joined_late).toBe(false);
    });
  });

  it('cannot be started twice', async () => {
    await startEvent(db, 0);
    const err = await expectError(() => call(db, `rpc_admin_event($1,$2)`, [EVENT_SLUG, 'start']));
    expect(err.code).toBe('GB403');
    expect(err.message).toMatch(/already/i);
  });

  it('deals every player the same 25 criteria in a different order', async () => {
    const layout = async (cardId: string) => {
      const r = await db.query<{ position: number }>(
        `select c.position from card_squares cs join criteria c on c.id = cs.criterion_id
          where cs.card_id = $1 order by cs.idx`, [cardId],
      );
      return r.rows.map((x) => x.position);
    };
    const la = await layout(a.card_id);
    const lb = await layout(b.card_id);

    expect(la).toHaveLength(25);
    expect([...la].sort((x, y) => x - y)).toEqual([...Array(25).keys()].map((i) => i + 1));
    expect([...lb].sort((x, y) => x - y)).toEqual([...Array(25).keys()].map((i) => i + 1));
    expect(la).not.toEqual(lb);
  });
});
