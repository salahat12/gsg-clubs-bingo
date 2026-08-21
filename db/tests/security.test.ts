import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, joinPlayer, startEvent, asRole, expectError, squareAt } from './harness';

/**
 * The security posture, asserted rather than assumed:
 * the anon key reads public game state and writes NOTHING, and cannot
 * call the rules engine directly.
 *
 * That last one matters most. Supabase exposes every function in the
 * public schema over PostgREST as /rest/v1/rpc/<name>. Without the
 * EXECUTE revoke in 0007_rls.sql, anyone with the anon key — which ships
 * in the browser bundle — could call rpc_respond_match and fill their own
 * card. These tests are the guard on that.
 */
describe('anon cannot write', () => {
  let db: PGlite;
  let player: { player_id: string; card_id: string; event_id: string };

  beforeAll(async () => {
    db = await freshDb();
    player = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
    await startEvent(db, 0);
  });

  const readable = [
    'events', 'criteria', 'players', 'cards', 'card_squares',
    'posts', 'replies', 'match_confirmations', 'bingos',
  ];
  const views = [
    'v_lobby_players', 'v_lobby_clusters', 'v_board_posts', 'v_board_replies',
    'v_leaderboard', 'v_card_squares', 'v_pending_confirmations', 'v_event_stats',
  ];

  it.each(readable)('can read %s', async (table) => {
    await asRole(db, 'anon', async () => {
      await expect(db.query(`select * from ${table} limit 1`)).resolves.toBeTruthy();
    });
  });

  it.each(views)('can read the %s view', async (view) => {
    await asRole(db, 'anon', async () => {
      await expect(db.query(`select * from ${view} limit 1`)).resolves.toBeTruthy();
    });
  });

  it.each(readable)('cannot insert into %s', async (table) => {
    await asRole(db, 'anon', async () => {
      const err = await expectError(() =>
        db.query(`insert into ${table} default values`));
      expect(err.message).toMatch(/permission denied|violates row-level security|null value|cannot insert/i);
    });
  });

  it('cannot fill its own square by updating the table directly', async () => {
    const sq = await squareAt(db, player.card_id, 5);
    await asRole(db, 'anon', async () => {
      const err = await expectError(() => db.query(
        `update card_squares set status='filled', filled_at=now() where id = $1`, [sq.id]));
      expect(err.message).toMatch(/permission denied/i);
    });
    const after = await db.query<{ status: string }>(
      `select status from card_squares where id = $1`, [sq.id]);
    expect(after.rows[0].status).toBe('empty');
  });

  it('cannot award itself a BINGO', async () => {
    await asRole(db, 'anon', async () => {
      const err = await expectError(() => db.query(
        `insert into bingos (event_id, player_id, line_key, elapsed_ms) values ($1,$2,'row:0',1)`,
        [player.event_id, player.player_id]));
      expect(err.message).toMatch(/permission denied/i);
    });
  });

  it('cannot start the event', async () => {
    await asRole(db, 'anon', async () => {
      const err = await expectError(() =>
        db.query(`update events set status='running', started_at=now()`));
      expect(err.message).toMatch(/permission denied/i);
    });
  });

  it('cannot delete another player', async () => {
    await asRole(db, 'anon', async () => {
      const err = await expectError(() => db.query(`delete from players`));
      expect(err.message).toMatch(/permission denied/i);
    });
  });

  const rpcs = [
    `rpc_join('gsg-clubs','X','Y','Z')`,
    `rpc_admin_event('gsg-clubs','start')`,
    `rpc_respond_match('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','confirm',null)`,
    `rpc_admin_undo_square('00000000-0000-0000-0000-000000000000')`,
    `rpc_admin_remove_player('00000000-0000-0000-0000-000000000000')`,
    `record_bingos('00000000-0000-0000-0000-000000000000')`,
    `assert_playable('00000000-0000-0000-0000-000000000000')`,
  ];

  it.each(rpcs)('cannot execute %s over PostgREST', async (expr) => {
    await asRole(db, 'anon', async () => {
      const err = await expectError(() => db.query(`select ${expr}`));
      expect(err.message).toMatch(/permission denied for function/i);
    });
  });

  it('cannot read internal bookkeeping tables at all', async () => {
    for (const t of ['pair_matches', 'rate_events']) {
      await asRole(db, 'anon', async () => {
        const err = await expectError(() => db.query(`select * from ${t}`));
        expect(err.message).toMatch(/permission denied/i);
      });
    }
  });

  it('hidden posts are invisible to anon at the row level, not just in the view', async () => {
    const sq = await squareAt(db, player.card_id, 7);
    const post: any = await db.query(
      `select rpc_create_post($1,$2,'request',null,'sec-1') as out`, [player.player_id, sq.id]);
    const postId = post.rows[0].out.post_id;
    await db.query(`select rpc_admin_hide_post($1, true)`, [postId]);

    await asRole(db, 'anon', async () => {
      const r = await db.query(`select id from posts where id = $1`, [postId]);
      expect(r.rows).toHaveLength(0);
    });
  });

  it('removed players are invisible to anon at the row level', async () => {
    const gone = await joinPlayer(db, 'Ghost', 'IUG', 'IEEE');
    await db.query(`select rpc_admin_remove_player($1)`, [gone.player_id]);
    await asRole(db, 'anon', async () => {
      const r = await db.query(`select id from players where id = $1`, [gone.player_id]);
      expect(r.rows).toHaveLength(0);
    });
  });
});

describe('rate limiting', () => {
  let db: PGlite;

  beforeAll(async () => { db = await freshDb(); });

  it('caps posting and keeps the message actionable', async () => {
    const p = await joinPlayer(db, 'Spammer', 'IUG', 'GDSC');
    await startEvent(db, 0);

    // 10 posts per minute; each needs its own square to avoid the
    // duplicate-open-post guard tripping first
    for (let i = 0; i < 10; i++) {
      const sq = await squareAt(db, p.card_id, i + 1);
      await db.query(`select rpc_create_post($1,$2,'request',null,$3)`,
        [p.player_id, sq.id, `spam-${i}`]);
    }
    const sq = await squareAt(db, p.card_id, 11);
    const err = await expectError(() => db.query(
      `select rpc_create_post($1,$2,'request',null,'spam-over')`, [p.player_id, sq.id]));
    expect(err.code).toBe('GB200');
    expect(err.message).toMatch(/too fast/i);
  });

  it('a retried write with the same client key is not a second post', async () => {
    const p = await joinPlayer(db, 'Flaky', 'AUG', 'IEEE');
    const sq = await squareAt(db, p.card_id, 3);

    const first: any = await db.query(
      `select rpc_create_post($1,$2,'request',null,'same-key') as out`, [p.player_id, sq.id]);
    const again: any = await db.query(
      `select rpc_create_post($1,$2,'request',null,'same-key') as out`, [p.player_id, sq.id]);

    expect(again.rows[0].out.post_id).toBe(first.rows[0].out.post_id);
    expect(again.rows[0].out.idempotent).toBe(true);

    const n = await db.query<{ n: number }>(
      `select count(*)::int n from posts where player_id = $1`, [p.player_id]);
    expect(n.rows[0].n).toBe(1);
  });
});
