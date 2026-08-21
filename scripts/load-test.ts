/**
 * Load test.
 *
 * Simulates the event at full size: joins N players, has them post and
 * reply, and runs the read path everyone's phone actually uses (a direct
 * Supabase poll) at the real cadence. Reports latency percentiles so the
 * numbers in the README are measured rather than hoped for.
 *
 *   npm run loadtest              # 300 players, the planning number
 *   PLAYERS=50 npm run loadtest
 */
const APP = process.env.SMOKE_APP_URL ?? 'http://localhost:3000';
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSPHRASE = process.env.ADMIN_PASSPHRASE!;

const PLAYERS = Number(process.env.PLAYERS ?? 300);
const POLL_ROUNDS = Number(process.env.POLL_ROUNDS ?? 3);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 25);

const UNIVERSITIES = [
  'Islamic University of Gaza', 'Al-Azhar University', 'Al-Aqsa University',
  'University College of Applied Sciences', 'An-Najah National University',
  'Birzeit University', 'Bethlehem University', 'Palestine Polytechnic University',
  'Hebron University', 'Arab American University',
];
const CLUBS = ['GDSC', 'IEEE', 'ACM', 'Robotics', 'Debate', 'Entrepreneurship', 'Media', 'Green Club'];
const NAMES = ['Bara','Sara','Omar','Lina','Yousef','Mays','Karim','Hala','Nour','Tareq','Rania','Ahmad','Dina','Sami','Farah','Ziad','Aya','Malak','Rami','Salma'];

let adminCookie = '';

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};

const summarise = (label: string, ms: number[], errors: number) => {
  console.log(
    `  ${label.padEnd(26)} n=${String(ms.length).padStart(4)}  ` +
    `p50 ${String(pct(ms, 50)).padStart(4)}ms  p95 ${String(pct(ms, 95)).padStart(4)}ms  ` +
    `max ${String(pct(ms, 100)).padStart(5)}ms` + (errors ? `  \x1b[31m${errors} errors\x1b[0m` : ''),
  );
};

/** Run tasks with a bounded number in flight, like real phones would be. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T | null, number, boolean]> {
  const t0 = performance.now();
  try {
    const r = await fn();
    return [r, performance.now() - t0, false];
  } catch {
    return [null, performance.now() - t0, true];
  }
}

const appPost = async (path: string, body: unknown, token?: string) => {
  const res = await fetch(`${APP}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(adminCookie ? { cookie: adminCookie } : {}),
      ...(token ? { 'x-player-token': token } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(json)}`);
  return json as Record<string, any>;
};

const supaGet = async (q: string) => {
  const res = await fetch(`${SUPABASE}/rest/v1/${q}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  if (!res.ok) throw new Error(`read ${q} -> ${res.status}`);
  return res.json();
};

async function main() {
  console.log(`\n\x1b[1mLoad test\x1b[0m  ${PLAYERS} players, ${CONCURRENCY} concurrent\n`);

  const login = await fetch(`${APP}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase: PASSPHRASE }),
  });
  adminCookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  await appPost('/api/admin/event', { action: 'reset', confirm: 'gsg-clubs' });

  // ---------------------------------------------------------------- join
  console.log('\x1b[1mJoining\x1b[0m  (everyone scanning the QR at once)');
  const joinMs: number[] = [];
  let joinErrors = 0;
  const t0 = performance.now();

  const players = await pool(Array.from({ length: PLAYERS }, (_, i) => i), CONCURRENCY, async (i) => {
    const [res, ms, failed] = await timed(() =>
      appPost('/api/join', {
        displayName: `${NAMES[i % NAMES.length]}${Math.floor(i / NAMES.length) || ''}`,
        university: UNIVERSITIES[i % UNIVERSITIES.length],
        club: CLUBS[i % CLUBS.length],
      }),
    );
    joinMs.push(ms);
    if (failed) joinErrors++;
    return res ? { token: res.token as string, id: res.player.id as string } : null;
  });

  const live = players.filter(Boolean) as Array<{ token: string; id: string }>;
  const joinWall = performance.now() - t0;
  summarise('POST /api/join', joinMs, joinErrors);
  console.log(`  ${live.length} cards dealt in ${(joinWall / 1000).toFixed(1)}s ` +
              `(${Math.round(live.length / (joinWall / 1000))}/s)\n`);

  const event = (await supaGet('events?slug=eq.gsg-clubs&select=id'))[0];

  // ------------------------------------------------------ lobby read path
  console.log('\x1b[1mLobby reads\x1b[0m  (what the projector and every phone poll)');
  const lobbyMs: number[] = [];
  let lobbyErrors = 0;
  await pool(Array.from({ length: Math.min(120, PLAYERS) }, (_, i) => i), CONCURRENCY, async () => {
    const [, ms, failed] = await timed(async () => {
      await Promise.all([
        supaGet(`v_lobby_clusters?event_id=eq.${event.id}&select=*`),
        supaGet(`v_lobby_players?event_id=eq.${event.id}&select=*&order=joined_at.asc&limit=400`),
      ]);
    });
    lobbyMs.push(ms);
    if (failed) lobbyErrors++;
  });
  summarise('lobby snapshot', lobbyMs, lobbyErrors);

  // ---------------------------------------------------------------- start
  await appPost('/api/admin/event', { action: 'start', countdownSeconds: 0 });
  await new Promise((r) => setTimeout(r, 400));

  // ------------------------------------------------------------- posting
  console.log('\n\x1b[1mBoard writes\x1b[0m  (half the room posts within a minute of the start)');
  const postMs: number[] = [];
  let postErrors = 0;
  const posters = live.slice(0, Math.ceil(live.length / 2));

  const posts = await pool(posters, CONCURRENCY, async (p, i) => {
    const sq = (await supaGet(`v_card_squares?player_id=eq.${p.id}&idx=eq.${i % 25}&select=id`))[0];
    const [res, ms, failed] = await timed(() =>
      appPost('/api/posts',
        { squareId: sq.id, kind: i % 2 ? 'request' : 'offer', clientKey: `load-${p.id}-${i}` },
        p.token),
    );
    postMs.push(ms);
    if (failed) postErrors++;
    return res?.postId as string | undefined;
  });
  summarise('POST /api/posts', postMs, postErrors);

  const openPosts = posts.filter(Boolean) as string[];
  const replyMs: number[] = [];
  let replyErrors = 0;
  await pool(openPosts.slice(0, 100), CONCURRENCY, async (postId, i) => {
    const replier = live[(i + 7) % live.length];
    const [, ms, failed] = await timed(() =>
      appPost(`/api/posts/${postId}/replies`,
        { body: 'I am by the registration desk in a red hoodie', clientKey: `loadr-${postId}-${i}` },
        replier.token),
    );
    replyMs.push(ms);
    if (failed) replyErrors++;
  });
  summarise('POST /replies', replyMs, replyErrors);

  // ---------------------------------------------------- the 3-second poll
  console.log('\n\x1b[1mThe 3-second poll\x1b[0m  (every phone, the real read path)');
  for (let round = 1; round <= POLL_ROUNDS; round++) {
    const ms: number[] = [];
    let errors = 0;
    await pool(live, CONCURRENCY, async (p) => {
      const [, t, failed] = await timed(async () => {
        await Promise.all([
          supaGet(`events?slug=eq.gsg-clubs&select=*`),
          supaGet(`v_board_posts?event_id=eq.${event.id}&select=*&order=created_at.desc&limit=25`),
          supaGet(`v_card_squares?player_id=eq.${p.id}&select=*&order=idx.asc`),
          supaGet(`v_pending_confirmations?confirmer_id=eq.${p.id}&select=*`),
        ]);
      });
      ms.push(t);
      if (failed) errors++;
    });
    summarise(`round ${round} full snapshot`, ms, errors);
  }

  const stats = (await supaGet(`v_event_stats?event_id=eq.${event.id}&select=*`))[0];
  console.log(`\n\x1b[1mFinal state\x1b[0m`);
  console.log(`  players ${stats.players_joined} · cards ${stats.cards_dealt} · posts ${stats.posts_count}`);
  console.log(`\n  Note: this drives the same endpoints a phone does, from one machine.`);
  console.log(`  Real phones add network latency but spread the load across 300 devices.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {};
