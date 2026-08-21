import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  freshDb, resetGame, joinPlayer, startEvent, call, squareAt, squareByIdx,
  forceFill, expectError, fullMatch, EVENT_SLUG,
} from './harness';

describe('admin controls', () => {
  let db: PGlite;

  beforeAll(async () => { db = await freshDb(); });
  beforeEach(async () => { await resetGame(db); });

  describe('undoing a confirmed square', () => {
    it('empties it, refunds the pair budget, and withdraws a BINGO that no longer holds', async () => {
      const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
      const b = await joinPlayer(db, 'Sara', 'AUG', 'IEEE');
      await startEvent(db, 0);

      // four of row 0 filled directly, the fifth won for real
      for (const idx of [0, 1, 2, 3]) {
        const sq = await squareByIdx(db, a.card_id, idx);
        await forceFill(db, sq.id, b.player_id);
      }
      const last = await squareByIdx(db, a.card_id, 4);
      const pos = await db.query<{ position: number }>(
        `select position from criteria where id = $1`, [last.criterion_id]);
      const res: any = await fullMatch(db, a, b, pos.rows[0].position);
      expect(res.new_lines).toEqual(['row:0']);

      await call(db, `rpc_admin_undo_square($1)`, [last.id]);

      const sq = await db.query<{ status: string; filled_at: string | null }>(
        `select status, filled_at from card_squares where id = $1`, [last.id]);
      expect(sq.rows[0].status).toBe('empty');
      expect(sq.rows[0].filled_at).toBeNull();

      const bingos = await db.query<{ n: number }>(
        `select count(*)::int n from bingos where player_id = $1`, [a.player_id]);
      expect(bingos.rows[0].n).toBe(0);

      const pair = await db.query<{ matched_count: number }>(`select matched_count from pair_matches`);
      expect(pair.rows[0].matched_count).toBe(0);
    });

    it('keeps a BINGO whose line still holds', async () => {
      const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
      const b = await joinPlayer(db, 'Sara', 'AUG', 'IEEE');
      await startEvent(db, 0);

      // fill all of row 0 AND col 0; undoing idx 4 breaks row 0 only
      for (const idx of [0, 1, 2, 3, 4, 5, 10, 15, 20]) {
        const sq = await squareByIdx(db, a.card_id, idx);
        await forceFill(db, sq.id, b.player_id);
      }
      await call(db, `record_bingos($1)`, [a.player_id]);
      const before = await db.query<{ n: number }>(
        `select count(*)::int n from bingos where player_id=$1`, [a.player_id]);
      expect(before.rows[0].n).toBe(2);   // row:0 and col:0

      const target = await squareByIdx(db, a.card_id, 4);
      await call(db, `rpc_admin_undo_square($1)`, [target.id]);

      const after = await db.query<{ line_key: string }>(
        `select line_key from bingos where player_id=$1`, [a.player_id]);
      expect(after.rows.map((r) => r.line_key)).toEqual(['col:0']);
    });

    it('refuses to undo a square that is not filled', async () => {
      const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
      await startEvent(db, 0);
      const sq = await squareByIdx(db, a.card_id, 0);
      const err = await expectError(() => call(db, `rpc_admin_undo_square($1)`, [sq.id]));
      expect(err.code).toBe('GB403');
    });
  });

  describe('moderation', () => {
    it('hiding a post removes it and its replies from the board feed', async () => {
      const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
      const b = await joinPlayer(db, 'Sara', 'AUG', 'IEEE');
      await startEvent(db, 0);

      const sq = await squareAt(db, a.card_id, 5);
      const post: any = await call(db, `rpc_create_post($1,$2,$3,$4,$5)`,
        [a.player_id, sq.id, 'request', 'at the registration desk', 'k1']);
      await call(db, `rpc_create_reply($1,$2,$3,$4)`, [b.player_id, post.post_id, 'on my way', 'r1']);

      let feed = await db.query(`select id from v_board_posts`);
      expect(feed.rows).toHaveLength(1);

      await call(db, `rpc_admin_hide_post($1,$2)`, [post.post_id, true]);
      feed = await db.query(`select id from v_board_posts`);
      expect(feed.rows).toHaveLength(0);

      await call(db, `rpc_admin_hide_post($1,$2)`, [post.post_id, false]);
      feed = await db.query(`select id from v_board_posts`);
      expect(feed.rows).toHaveLength(1);
    });

    it('hiding a single reply leaves the post standing', async () => {
      const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
      const b = await joinPlayer(db, 'Sara', 'AUG', 'IEEE');
      await startEvent(db, 0);
      const sq = await squareAt(db, a.card_id, 5);
      const post: any = await call(db, `rpc_create_post($1,$2,$3,$4,$5)`,
        [a.player_id, sq.id, 'request', null, 'k1']);
      const reply: any = await call(db, `rpc_create_reply($1,$2,$3,$4)`,
        [b.player_id, post.post_id, 'rude thing', 'r1']);

      await call(db, `rpc_admin_hide_reply($1,$2)`, [reply.reply_id, true]);

      const replies = await db.query(`select id from v_board_replies`);
      expect(replies.rows).toHaveLength(0);
      const feed = await db.query<{ reply_count: number }>(`select reply_count from v_board_posts`);
      expect(feed.rows[0].reply_count).toBe(0);
    });

    it('removing a player closes their posts, cancels their pending matches, and frees the squares', async () => {
      const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
      const b = await joinPlayer(db, 'Sara', 'AUG', 'IEEE');
      await startEvent(db, 0);

      const sq = await squareAt(db, a.card_id, 5);
      const post: any = await call(db, `rpc_create_post($1,$2,$3,$4,$5)`,
        [a.player_id, sq.id, 'request', null, 'k1']);
      await call(db, `rpc_request_match($1,$2,$3,$4)`,
        [a.player_id, b.player_id, sq.id, post.post_id]);

      await call(db, `rpc_admin_remove_player($1)`, [a.player_id]);

      const p = await db.query<{ status: string }>(`select status from posts where id=$1`, [post.post_id]);
      expect(p.rows[0].status).toBe('closed');

      const mc = await db.query<{ status: string }>(
        `select status from match_confirmations where requester_id=$1`, [a.player_id]);
      expect(mc.rows[0].status).toBe('cancelled');

      const s = await db.query<{ status: string }>(`select status from card_squares where id=$1`, [sq.id]);
      expect(s.rows[0].status).toBe('empty');

      const lobby = await db.query(`select id from v_lobby_players`);
      expect(lobby.rows).toHaveLength(1);
    });

    it('a removed player cannot act any more, even holding a valid token', async () => {
      const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
      await startEvent(db, 0);
      await call(db, `rpc_admin_remove_player($1)`, [a.player_id]);
      const sq = await squareAt(db, a.card_id, 5);
      const err = await expectError(() => call(db, `rpc_create_post($1,$2,$3,$4,$5)`,
        [a.player_id, sq.id, 'request', null, 'k2']));
      expect(err.code).toBe('GB400');
    });
  });

  describe('editing criteria without a redeploy', () => {
    it('propagates new text to cards already dealt', async () => {
      const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
      const c = await db.query<{ id: string }>(
        `select id from criteria where position = 5 and event_id = $1`, [a.event_id]);

      await call(db, `rpc_admin_update_criterion($1,$2,$3)`,
        [c.rows[0].id, 'Find someone who owns a cat', null]);

      const sq = await db.query<{ criterion_text: string }>(
        `select criterion_text from v_card_squares where player_id = $1 and criterion_id = $2`,
        [a.player_id, c.rows[0].id]);
      expect(sq.rows[0].criterion_text).toBe('Find someone who owns a cat');
    });

    it('rejects an unknown rule', async () => {
      const c = await db.query<{ id: string }>(`select id from criteria where position = 5`);
      const err = await expectError(() =>
        call(db, `rpc_admin_update_criterion($1,$2,$3)`, [c.rows[0].id, null, 'do_whatever']));
      expect(err.code).toBe('GB403');
    });

    it('refuses to deal a card when the pool is not exactly 25', async () => {
      await db.query(`update criteria set active = false where position = 25`);
      const err = await expectError(() => joinPlayer(db, 'Nope', 'IUG', 'GDSC'));
      expect(err.code).toBe('GB402');
      expect(err.message).toMatch(/exactly 25/);
      await db.query(`update criteria set active = true where position = 25`);
    });
  });

  describe('reset for a rerun', () => {
    it('requires the slug typed back exactly', async () => {
      const err = await expectError(() =>
        call(db, `rpc_admin_event($1,$2,$3)`, [EVENT_SLUG, 'reset', 'wrong']));
      expect(err.code).toBe('GB403');
      expect(err.message).toMatch(/type the event slug/i);
    });

    it('wipes players, cards, posts and BINGOs and returns to waiting', async () => {
      const a = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
      const b = await joinPlayer(db, 'Sara', 'AUG', 'IEEE');
      await startEvent(db, 0);
      await fullMatch(db, a, b, 5);

      const res: any = await call(db, `rpc_admin_event($1,$2,$3)`, [EVENT_SLUG, 'reset', EVENT_SLUG]);
      expect(res.players_removed).toBe(2);

      for (const t of ['players', 'cards', 'card_squares', 'posts', 'bingos', 'match_confirmations']) {
        const r = await db.query<{ n: number }>(`select count(*)::int n from ${t}`);
        expect(r.rows[0].n, `${t} should be empty after reset`).toBe(0);
      }

      const e = await db.query<{ status: string; started_at: string | null }>(
        `select status, started_at from events where slug = $1`, [EVENT_SLUG]);
      expect(e.rows[0].status).toBe('waiting');
      expect(e.rows[0].started_at).toBeNull();

      const crit = await db.query<{ n: number }>(`select count(*)::int n from criteria`);
      expect(crit.rows[0].n, 'criteria survive a reset').toBe(25);
    });
  });
});
