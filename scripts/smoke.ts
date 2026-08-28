/**
 * End-to-end smoke test.
 *
 * Drives the real HTTP API against a real Supabase, the same path a phone
 * takes. The unit suite proves the rules in isolation; this proves the
 * wiring — route handlers, token auth, RLS, and the anon read path all
 * agreeing with each other.
 *
 *   npm run dev        # in one terminal
 *   npm run smoke      # in another
 */
import { mintScanCredential } from '../src/lib/scanToken';

const APP = process.env.SMOKE_APP_URL ?? 'http://localhost:3000';
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSPHRASE = process.env.ADMIN_PASSPHRASE!;
const SCAN_SECRET = process.env.SCAN_TOKEN_SECRET!;

let pass = 0;
let fail = 0;
let adminCookie = '';

function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`); }
}

function section(name: string) { console.log(`\n\x1b[1m${name}\x1b[0m`); }

async function api(path: string, body: unknown, token?: string) {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-player-token': token } : {}),
      ...(adminCookie ? { cookie: adminCookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as Record<string, any>, res };
}

async function read<T = any>(pathAndQuery: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  if (!res.ok) throw new Error(`read ${pathAndQuery} -> ${res.status} ${await res.text()}`);
  return res.json();
}

type Player = { token: string; id: string; cardId: string; name: string };

async function join(
  name: string,
  universityValue: string,
  universityOtherText: string | null = null,
): Promise<Player> {
  const { json, status } = await api('/api/join', { displayName: name, universityValue, universityOtherText });
  if (status !== 200) throw new Error(`join ${name} failed: ${JSON.stringify(json)}`);
  return { token: json.token, id: json.player.id, cardId: json.player.cardId, name };
}

const squareAtIdx = async (playerId: string, idx: number) =>
  (await read(`v_card_squares?player_id=eq.${playerId}&idx=eq.${idx}&select=*`))[0];

const squareForPosition = async (playerId: string, position: number) =>
  (await read(`v_card_squares?player_id=eq.${playerId}&criterion_position=eq.${position}&select=*`))[0];

/** The one real path a fill takes now: mint the scanned player's current
 *  token, then call /api/scan/fill as the scanning player. */
async function scanFill(scanning: Player, scanned: Player, square: any) {
  const { token } = mintScanCredential(scanned.id, SCAN_SECRET);
  return api(
    '/api/scan/fill',
    { code: token, squareId: square.id, clientKey: `smoke-${square.id}-${Date.now()}` },
    scanning.token,
  );
}

async function main() {
  console.log(`\x1b[1mSmoke test\x1b[0m  app=${APP}\n`);

  // ---------------------------------------------------------------- admin
  section('Admin');
  const login = await fetch(`${APP}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: PASSPHRASE }),
  });
  adminCookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  check('admin can sign in with the passphrase', login.status === 200 && adminCookie.length > 0);

  const badLogin = await fetch(`${APP}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: 'wrong-passphrase' }),
  });
  check('a wrong passphrase is rejected', badLogin.status === 401);

  const reset = await api('/api/admin/event', { action: 'reset', confirm: 'gsg-clubs' });
  check('event resets to a clean slate', reset.status === 200, JSON.stringify(reset.json));

  const badReset = await api('/api/admin/event', { action: 'reset', confirm: 'nope' });
  check('reset refuses without the slug typed back', badReset.status === 400);

  // ----------------------------------------------------------------- join
  section('Joining');
  const a = await join('Bara', 'aqu');
  const b = await join('Sara', 'hu');
  const c = await join('Omar', 'bzu');
  const d = await join('Lina', 'ppu');
  check('four players joined and got cards', [a, b, c, d].every((p) => p.id && p.cardId));

  const cardA = await read(`v_card_squares?player_id=eq.${a.id}&select=idx,criterion_position`);
  const cardB = await read(`v_card_squares?player_id=eq.${b.id}&select=idx,criterion_position`);
  check('a card is 25 squares', cardA.length === 25);
  check('a card holds each of the 25 criteria once',
    new Set(cardA.map((s: any) => s.criterion_position)).size === 25);
  check('two players get different layouts',
    JSON.stringify(cardA.map((s: any) => s.criterion_position)) !==
    JSON.stringify(cardB.map((s: any) => s.criterion_position)));

  // ----------------------------------------------------------- start gate
  section('Start gate');
  const sq0 = await squareAtIdx(a.id, 0);
  const early = await api('/api/posts',
    { squareId: sq0.id, kind: 'request', clientKey: 'too-early' }, a.token);
  check('posting is rejected before the game starts', early.status === 409 && early.json.code === 'GB100',
    `${early.status} ${early.json.code}`);

  const started = await api('/api/admin/event', { action: 'start', countdownSeconds: 0 });
  check('admin starts the game', started.status === 200, JSON.stringify(started.json));
  await new Promise((r) => setTimeout(r, 400));

  // ------------------------------------------------------------- scan fill
  section('Scan fill');
  const selfSquare = await squareForPosition(a.id, 5);
  const selfScan = await scanFill(a, a, selfSquare);
  check('a player cannot scan their own code', selfScan.status === 409 && selfScan.json.code === 'GB300',
    `${selfScan.status} ${selfScan.json.code}`);

  // criterion 4: different university. A(aqu) vs B(hu) is fine.
  const uniSquare = await squareForPosition(a.id, 4);
  const uniFill = await scanFill(a, b, uniSquare);
  check('criterion 4 passes for different universities', uniFill.status === 200,
    JSON.stringify(uniFill.json));

  const filledSq = await squareAtIdx(a.id, uniSquare.idx);
  check('the square is now filled', filledSq.status === 'filled', filledSq.status);
  check('and credits the person who was scanned', filledSq.filled_by_name === 'Sara',
    String(filledSq.filled_by_name));

  // criterion 4 must fail between two people at the same university
  const e = await join('Yousef', 'aqu');
  const eUniSquare = await squareForPosition(e.id, 4);
  const sameUni = await scanFill(e, a, eUniSquare);
  check('criterion 4 is refused for the same university',
    sameUni.json?.code === 'GB302', JSON.stringify(sameUni.json));

  // criterion 7 ("was in the previous scholarship") is honor system now —
  // every attendee is the same cohort, so it fills like any other square.
  // Scanned with c, not b, so it doesn't eat into the a<->b pair cap the
  // next section relies on.
  const cohortSquareOnA = await squareForPosition(a.id, 7);
  const cohortFill = await scanFill(a, c, cohortSquareOnA);
  check('criterion 7 is honor system, not server-checked',
    cohortFill.status === 200, JSON.stringify(cohortFill.json));

  // ------------------------------------------------------------ pair cap
  section('Pair cap');
  const third = await squareForPosition(a.id, 9);
  const capped = await scanFill(a, b, third);
  check('a second fill with the same person is allowed',
    capped.status === 200, JSON.stringify(capped.json));

  const fourth = await squareForPosition(a.id, 12);
  const over = await scanFill(a, b, fourth);
  check('a third fill with the same person is refused',
    over.json?.code === 'GB301', JSON.stringify(over.json).slice(0, 160));

  // ----------------------------------------------------------- idempotency
  section('Idempotency');
  const idemSquare = await squareForPosition(c.id, 5);
  const key = `idem-${Date.now()}`;
  const { token: cToken } = mintScanCredential(d.id, SCAN_SECRET);
  const first = await api('/api/scan/fill', { code: cToken, squareId: idemSquare.id, clientKey: key }, c.token);
  const again = await api('/api/scan/fill', { code: cToken, squareId: idemSquare.id, clientKey: key }, c.token);
  check('a retried fill with the same client key replays the same result',
    again.status === 200 && JSON.stringify(again.json) === JSON.stringify(first.json),
    JSON.stringify({ first: first.json, again: again.json }));

  // ---------------------------------------------------------------- bingo
  section('BINGO, top helpers, and leaderboard');
  const helpers = [
    await join('Helper1', 'bzu'),
    await join('Helper2', 'nnu'),
    await join('Helper3', 'hu'),
  ];
  let helperIdx = 0;
  for (let idx = 0; idx < 5; idx++) {
    const sq = await squareAtIdx(d.id, idx);
    if (sq.status === 'filled') continue;
    let filled = false;
    for (let attempt = 0; attempt < helpers.length && !filled; attempt++) {
      const helper = helpers[(Math.floor(helperIdx / 2) + attempt) % helpers.length];
      const r = await scanFill(d, helper, sq);
      if (r.status === 200) filled = true;
    }
    helperIdx++;
  }

  const row0 = await read(`v_card_squares?player_id=eq.${d.id}&idx=lt.5&select=idx,status`);
  check('row 0 is fully filled', row0.every((s: any) => s.status === 'filled'),
    JSON.stringify(row0.map((s: any) => s.status)));

  const bingos = await read(`bingos?player_id=eq.${d.id}&select=line_key,elapsed_ms`);
  check('a BINGO was recorded server-side', bingos.length >= 1, JSON.stringify(bingos));
  check('the line recorded is row:0', bingos.some((b: any) => b.line_key === 'row:0'),
    JSON.stringify(bingos.map((b: any) => b.line_key)));

  const board = await read(`v_leaderboard?select=display_name,elapsed_ms,lines_completed&order=elapsed_ms.asc`);
  check('the player appears on the leaderboard', board.some((r: any) => r.display_name === 'Lina'),
    JSON.stringify(board));
  check('a player appears only once', new Set(board.map((r: any) => r.display_name)).size === board.length);

  // Push one helper's count past the pair cap of 2 with two more distinct
  // pairs, so "not capped by the pair cap" is actually exercised rather
  // than asserted on whatever the row-0 fill happened to produce.
  const strangers = [await join('Stranger1', 'nnu'), await join('Stranger2', 'ppu')];
  for (const s of strangers) {
    const sq = await squareForPosition(s.id, 9); // honor
    await scanFill(s, helpers[0], sq);
  }

  const topHelpers = await read(`v_top_helpers?select=display_name,helped_count&order=helped_count.desc`);
  check('top helpers are not capped by the pair cap',
    topHelpers.some((h: any) => h.helped_count > 2), JSON.stringify(topHelpers));

  // -------------------------------------------------------------- undo
  section('Admin undo');
  const toUndo = await squareAtIdx(a.id, uniSquare.idx);
  const undo = await api('/api/admin/moderate', { action: 'undo_square', id: toUndo.id });
  check('admin can undo a filled square', undo.status === 200, JSON.stringify(undo.json));
  const afterUndo = await squareAtIdx(a.id, uniSquare.idx);
  check('the square is empty again', afterUndo.status === 'empty', afterUndo.status);

  // ------------------------------------------------------------- security
  section('Security');
  const noToken = await api('/api/posts', { squareId: sq0.id, kind: 'request', clientKey: 'no-token-x' });
  check('a write without a token is rejected', noToken.status === 401);

  const forged = await api('/api/posts',
    { squareId: sq0.id, kind: 'request', clientKey: 'tampered-y' }, `${a.token}tampered`);
  check('a tampered token is rejected', forged.status === 401);

  const forgedScan = await api('/api/scan/fill',
    { code: mintScanCredential(b.id, SCAN_SECRET).token, squareId: sq0.id, clientKey: 'tampered-z' },
    `${a.token}tampered`);
  check('a tampered token is rejected on the scan-fill route too', forgedScan.status === 401);

  const wrongSecretToken = mintScanCredential(b.id, `${SCAN_SECRET}-wrong`).token;
  const badScanToken = await api('/api/scan/fill',
    { code: wrongSecretToken, squareId: sq0.id, clientKey: 'wrong-sec' }, a.token);
  check('a scan token signed with the wrong secret is rejected',
    badScanToken.status === 400 && badScanToken.json.code === 'GB401', JSON.stringify(badScanToken.json));

  const anonWrite = await fetch(`${SUPABASE}/rest/v1/bingos`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: '00000000-0000-0000-0000-000000000000', player_id: a.id, line_key: 'row:1', elapsed_ms: 1 }),
  });
  check('the anon key cannot award a BINGO directly', anonWrite.status >= 400, String(anonWrite.status));

  const anonRpc = await fetch(`${SUPABASE}/rest/v1/rpc/rpc_scan_fill`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_scanning_player_id: a.id, p_square_id: sq0.id, p_scanned_player_id: b.id, p_client_key: 'anon-rpc',
    }),
  });
  check('the anon key cannot call the rules engine', anonRpc.status >= 400, String(anonRpc.status));

  // ------------------------------------------------------------------ end
  section('Ending');
  const ended = await api('/api/admin/event', { action: 'end' });
  check('admin ends the game', ended.status === 200);

  const afterEnd = await api('/api/posts',
    { squareId: sq0.id, kind: 'request', clientKey: 'after-end' }, a.token);
  check('writes are refused after the game ends',
    afterEnd.status === 409 && afterEnd.json.code === 'GB102', `${afterEnd.status} ${afterEnd.json.code}`);

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error('\n\x1b[31mSmoke test crashed\x1b[0m\n', err); process.exit(1); });

export {};
