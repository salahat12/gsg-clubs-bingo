/**
 * Drives a real browser through the real app to capture screens and, more
 * importantly, to MEASURE the card.
 *
 * The brief called out one hard constraint: the criteria have to be
 * legible in a 5x5 grid at 375px, and criterion 15 is the longest. This
 * script reports the rendered font size and overflow of every tile so the
 * claim is measured rather than asserted.
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.SMOKE_APP_URL ?? 'http://localhost:3000';
const OUT = join(process.cwd(), 'docs', 'screenshots');
const PASSPHRASE = process.env.ADMIN_PASSPHRASE!;
const LONGEST = 'Find someone who joined their club without knowing what they were getting into';

mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();

  // ---- reset + seed a room worth photographing -----------------------
  const admin = await browser.newContext({ ...devices['iPhone SE'] });
  const ap = await admin.newPage();
  await ap.goto(`${APP}/admin`);
  await ap.fill('input[type="password"]', PASSPHRASE);
  await ap.click('button[type="submit"]');
  await ap.waitForSelector('text=Event controls', { timeout: 15_000 });

  const cookies = await admin.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  // Fails loudly. A seeding step that silently no-ops produces a
  // screenshot of an empty screen and a false sense that it is correct.
  const post = async (path: string, body: unknown, token?: string) => {
    const res = await fetch(`${APP}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieHeader,
        ...(token ? { 'x-player-token': token } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${JSON.stringify(json)}`);
    return json as Record<string, any>;
  };

  await post('/api/admin/event', { action: 'reset', confirm: 'gsg-clubs' });

  const ROSTER: Array<[string, string, string]> = [
    ['Bara', 'Islamic University of Gaza', 'GDSC'],
    ['Sara', 'Islamic University of Gaza', 'IEEE'],
    ['Omar', 'Islamic University of Gaza', 'GDSC'],
    ['Lina', 'Islamic University of Gaza', 'ACM'],
    ['Yousef', 'Al-Azhar University', 'IEEE'],
    ['Mays', 'Al-Azhar University', 'GDSC'],
    ['Karim', 'Al-Azhar University', 'Robotics'],
    ['Hala', 'Al-Aqsa University', 'GDSC'],
    ['Nour', 'Al-Aqsa University', 'IEEE'],
    ['Tareq', 'University College of Applied Sciences', 'ACM'],
    ['Rania', 'University College of Applied Sciences', 'GDSC'],
    ['Ahmad', 'An-Najah National University', 'IEEE'],
    ['Dina', 'An-Najah National University', 'Robotics'],
    ['Sami', 'Birzeit University', 'GDSC'],
    ['Farah', 'Birzeit University', 'ACM'],
    ['Ziad', 'Bethlehem University', 'IEEE'],
  ];

  const players: Array<{ token: string; id: string; name: string }> = [];
  for (const [name, uni, club] of ROSTER) {
    const r = await post('/api/join', { displayName: name, university: uni, club });
    players.push({ token: r.token, id: r.player.id, name });
  }

  // ---- lobby, before the start ---------------------------------------
  // 375x780 — the width the brief specifies for the card legibility test
  const phone = await browser.newContext({ viewport: { width: 375, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await phone.newPage();
  await page.addInitScript(
    ([token, player]) => {
      localStorage.setItem('gsg-bingo.token.v1', JSON.stringify(token));
      localStorage.setItem('gsg-bingo.player.v1', JSON.stringify(player));
      localStorage.setItem('gsg-bingo.rules-seen.v1', 'true');
    },
    [players[0].token, { id: players[0].id, cardId: '', eventId: '', displayName: 'Bara', university: 'Islamic University of Gaza', club: 'GDSC', joinedLate: false }] as const,
  );

  await page.goto(`${APP}/lobby`);
  await page.waitForSelector('svg[role="img"]', { timeout: 15_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'lobby-phone.png') });

  const projector = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const pp = await projector.newPage();
  await pp.goto(`${APP}/lobby?display=1`);
  await pp.waitForSelector('svg[role="img"]', { timeout: 15_000 });
  await pp.waitForTimeout(1200);
  await pp.screenshot({ path: join(OUT, 'lobby-projector.png') });

  // ---- start, then the card ------------------------------------------
  await post('/api/admin/event', { action: 'start', countdownSeconds: 0 });
  await new Promise((r) => setTimeout(r, 600));

  await page.goto(`${APP}/play/card`);
  await page.waitForSelector('[role="grid"]', { timeout: 15_000 });
  await page.waitForTimeout(900);

  // ---- MEASURE ---------------------------------------------------------
  const measure = async (pg: import('playwright').Page) => pg.evaluate((longest) => {
    const cells = Array.from(document.querySelectorAll('[role="gridcell"]'));
    return cells.map((cell) => {
      const span = cell.querySelector('[data-fit]') as HTMLElement;
      const rect = cell.getBoundingClientRect();
      return {
        text: span.textContent ?? '',
        chars: (span.textContent ?? '').length,
        fontPx: Number.parseFloat(getComputedStyle(span).fontSize),
        tileW: Math.round(rect.width * 10) / 10,
        tileH: Math.round(rect.height * 10) / 10,
        overflowPx: span.scrollHeight - span.clientHeight,
        isLongest: (span.textContent ?? '').trim() === longest,
      };
    });
  }, LONGEST);

  // The brief specifies 375px. 320px is measured too, because that is the
  // narrowest phone still in circulation and it is the case that actually
  // bites — if it passes there it passes everywhere.
  let anyClipped = false;
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 780 });
    await page.waitForTimeout(500);
    const m = await measure(page);

    const clipped = m.filter((x) => x.overflowPx > 1);
    const longest = m.find((x) => x.isLongest)!;
    const smallest = m.reduce((a, b) => (a.fontPx < b.fontPx ? a : b));
    anyClipped ||= clipped.length > 0;

    console.log(`\n\x1b[1mCard legibility at ${width}px\x1b[0m`);
    console.log(`  tile size            ${m[0].tileW}px x ${m[0].tileH}px`);
    console.log(`  font size range      ${smallest.fontPx.toFixed(1)}px – ${Math.max(...m.map((x) => x.fontPx)).toFixed(1)}px`);
    console.log(`  criterion 15         ${longest.chars} chars at ${longest.fontPx.toFixed(1)}px, overflow ${longest.overflowPx}px`);
    console.log(`  tiles clipping text  ${clipped.length} of ${m.length}`);
    for (const c of clipped) {
      console.log(`    ! ${c.fontPx.toFixed(1)}px overflow ${c.overflowPx}px — ${c.text.slice(0, 58)}`);
    }
    await page.screenshot({ path: join(OUT, `card-${width}.png`) });
  }

  await page.setViewportSize({ width: 375, height: 780 });
  await page.waitForTimeout(400);

  // list view, the accessible alternative
  await page.click('button:has-text("list")');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'card-list-375.png'), fullPage: true });
  await page.click('button:has-text("grid")');

  // ---- board -----------------------------------------------------------
  for (let i = 1; i <= 5; i++) {
    const card = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/v_card_squares?player_id=eq.${players[i].id}&idx=eq.${i}&select=id`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}` } },
    ).then((r) => r.json());
    const p = await post('/api/posts',
      { squareId: card[0].id, kind: i % 2 ? 'request' : 'offer', note: i === 1 ? 'I am by the coffee table in a red hoodie' : undefined, clientKey: `shot-seed-${i}-${Date.now()}` },
      players[i].token);
    if (i <= 2) {
      await post(`/api/posts/${p.postId}/replies`,
        { body: i === 1 ? 'On my way — I am near the registration desk' : 'I can help with this one', clientKey: `shot-reply-${i}-${Date.now()}` },
        players[(i + 3) % players.length].token);
    }
  }

  await page.goto(`${APP}/play/board`);
  await page.waitForSelector('text=Requests', { timeout: 15_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, 'board-375.png') });

  // ---- QR poster -------------------------------------------------------
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const dp = await desktop.newPage();
  await dp.context().addCookies(cookies);
  await dp.goto(`${APP}/admin/qr`);
  await dp.waitForSelector('img[alt^="QR code"]', { timeout: 20_000 });
  await dp.waitForTimeout(800);
  await dp.screenshot({ path: join(OUT, 'qr-poster.png'), fullPage: true });

  // ---- admin -----------------------------------------------------------
  await ap.goto(`${APP}/admin`);
  await ap.waitForSelector('text=Event controls');
  await ap.waitForTimeout(700);
  await ap.screenshot({ path: join(OUT, 'admin-375.png'), fullPage: true });

  await browser.close();

  const ok = !anyClipped;
  console.log(`\n  \x1b[${ok ? 32 : 31}m${ok ? '✓' : '✗'}\x1b[0m every criterion fits its tile without clipping\n`);
  console.log(`  screenshots -> docs/screenshots/\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {};
