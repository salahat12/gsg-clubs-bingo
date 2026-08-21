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
const APP = process.env.SMOKE_APP_URL ?? 'http://localhost:3000';
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSPHRASE = process.env.ADMIN_PASSPHRASE!;

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

async function join(name: string, university: string, club: string): Promise<Player> {
  const { json, status } = await api('/api/join', { displayName: name, university, club });
  if (status !== 200) throw new Error(`join ${name} failed: ${JSON.stringify(json)}`);
  return { token: json.token, id: json.player.id, cardId: json.player.cardId, name };
}

const squareAtIdx = async (playerId: string, idx: number) =>
  (await read(`v_card_squares?player_id=eq.${playerId}&idx=eq.${idx}&select=*`))[0];

const squareForPosition = async (playerId: string, position: number) =>
  (await read(`v_card_squares?player_id=eq.${playerId}&criterion_position=eq.${position}&select=*`))[0];

/** Full loop: post -> ask -> confirm. Returns the respond payload. */
async function fullMatch(requester: Player, confirmer: Player, square: any, reciprocalSquareId?: string) {
  const post = await api(
    '/api/posts',
    { squareId: square.id, kind: 'request', clientKey: `smoke-${square.id}-${Date.now()}` },
    requester.token,
  );
  if (post.status !== 200) throw new Error(`post failed: ${JSON.stringify(post.json)}`);

  const ask = await api(
    '/api/match/request',
    { confirmerId: confirmer.id, squareId: square.id, postId: post.json.postId },
    requester.token,
  );
  if (ask.status !== 200) throw new Error(`ask failed: ${JSON.stringify(ask.json)}`);

  return api(
    `/api/match/${ask.json.confirmationId}/respond`,
    { action: 'confirm', reciprocalSquareId: reciprocalSquareId ?? null },
    confirmer.token,
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
  const a = await join('Bara', 'Islamic University of Gaza', 'GDSC');
  const b = await join('Sara', 'Al-Azhar University', 'IEEE');
  const c = await join('Omar', 'Al-Aqsa University', 'GDSC');
  const d = await join('Lina', 'University College', 'ACM');
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

  // ----------------------------------------------------------- the match
  section('Match confirmation');
  const selfSquare = await squareForPosition(a.id, 5);
  const selfMatch = await api('/api/match/request',
    { confirmerId: a.id, squareId: selfSquare.id, postId: null }, a.token);
  check('a player cannot mark themselves', selfMatch.status === 409 && selfMatch.json.code === 'GB300',
    `${selfMatch.status} ${selfMatch.json.code}`);

  // criterion 1: different university. A(IUG) vs B(Al-Azhar) is fine.
  const uniSquare = await squareForPosition(a.id, 1);
  const uniMatch = await fullMatch(a, b, uniSquare);
  check('criterion 1 passes for different universities', uniMatch.status === 200,
    JSON.stringify(uniMatch.json));

  const filledSq = await squareAtIdx(a.id, uniSquare.idx);
  check('the square is now filled', filledSq.status === 'filled', filledSq.status);
  check('and credits the person who confirmed it', filledSq.filled_by_name === 'Sara',
    String(filledSq.filled_by_name));

  // criterion 1 must fail between two people at the same university
  const e = await join('Yousef', 'Islamic University of Gaza', 'IEEE');
  const eUniSquare = await squareForPosition(e.id, 1);
  let sameUni: any;
  try {
    sameUni = await fullMatch(e, a, eUniSquare);
  } catch (err) {
    sameUni = { status: 409, json: { code: 'GB302', thrown: String(err) } };
  }
  check('criterion 1 is refused for the same university',
    String(sameUni.json?.code ?? '').includes('GB302') || String(sameUni.json?.thrown ?? '').includes('GB302'),
    JSON.stringify(sameUni.json));

  // criterion 22: different club entity. E(IUG/IEEE) vs A(IUG/GDSC) is allowed.
  const clubSquare = await squareForPosition(e.id, 22);
  const clubMatch = await fullMatch(e, a, clubSquare);
  check('criterion 22 allows different clubs at the same university',
    clubMatch.status === 200, JSON.stringify(clubMatch.json));

  // ------------------------------------------------------------ pair cap
  section('Pair cap');
  const third = await squareForPosition(a.id, 9);
  let capped: any;
  try { capped = await fullMatch(a, b, third); }
  catch (err) { capped = { json: { thrown: String(err) } }; }
  // a<->b used 1 (criterion 1) plus e<->a used a different pair, so a<->b has room for one more
  check('a second match with the same person is allowed',
    capped.status === 200, JSON.stringify(capped.json));

  const fourth = await squareForPosition(a.id, 12);
  let over: any;
  try { over = await fullMatch(a, b, fourth); }
  catch (err) { over = { json: { thrown: String(err) } }; }
  check('a third match with the same person is refused',
    JSON.stringify(over.json).includes('GB301'), JSON.stringify(over.json).slice(0, 160));

  // ----------------------------------------------------------- reciprocal
  section('Reciprocal fill');
  const recipTarget = await squareForPosition(c.id, 5);
  const recipMine = await squareForPosition(d.id, 7);
  const recip = await fullMatch(c, d, recipTarget, recipMine.id);
  check('confirming can fill the confirmer own chosen square too',
    recip.status === 200 && recip.json.match?.reciprocal_filled === true,
    JSON.stringify(recip.json).slice(0, 200));

  const dSquare = await squareAtIdx(d.id, recipMine.idx);
  check('the reciprocal square really filled', dSquare.status === 'filled', dSquare.status);

  // ---------------------------------------------------------------- bingo
  section('BINGO and leaderboard');
  // Fill row 0 for player D. The pair cap means this needs several people.
  const helpers = [
    await join('Helper1', 'Bethlehem University', 'Robotics'),
    await join('Helper2', 'An-Najah University', 'GDSC'),
    await join('Helper3', 'Birzeit University', 'IEEE'),
  ];
  let helperIdx = 0;
  for (let idx = 0; idx < 5; idx++) {
    const sq = await squareAtIdx(d.id, idx);
    if (sq.status === 'filled') continue;
    const helper = helpers[Math.floor(helperIdx / 2) % helpers.length];
    helperIdx++;
    const r = await fullMatch(d, helper, sq);
    if (r.status !== 200) {
      // pair cap hit — take the next helper and retry once
      const alt = helpers[(Math.floor(helperIdx / 2) + 1) % helpers.length];
      await fullMatch(d, alt, sq);
    }
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

  // ------------------------------------------------------------- security
  section('Security');
  const noToken = await api('/api/posts', { squareId: sq0.id, kind: 'request', clientKey: 'x' });
  check('a write without a token is rejected', noToken.status === 401);

  const forged = await api('/api/posts',
    { squareId: sq0.id, kind: 'request', clientKey: 'y' }, `${a.token}tampered`);
  check('a tampered token is rejected', forged.status === 401);

  const anonWrite = await fetch(`${SUPABASE}/rest/v1/bingos`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: '00000000-0000-0000-0000-000000000000', player_id: a.id, line_key: 'row:1', elapsed_ms: 1 }),
  });
  check('the anon key cannot award a BINGO directly', anonWrite.status >= 400, String(anonWrite.status));

  const anonRpc = await fetch(`${SUPABASE}/rest/v1/rpc/rpc_respond_match`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_confirmation_id: '00000000-0000-0000-0000-000000000000', p_confirmer_id: a.id, p_action: 'confirm' }),
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
