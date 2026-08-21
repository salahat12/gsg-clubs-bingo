/**
 * Exports the QR assets as files.
 *
 *   npm run qr                          # uses NEXT_PUBLIC_SITE_URL
 *   npm run qr -- https://your.app      # or an explicit URL
 *
 * Produces, in docs/qr/:
 *   gsg-bingo-qr.svg      pure QR, vector, drop into any design
 *   gsg-bingo-qr.png      pure QR, 2048px, well past print resolution
 *   gsg-bingo-poster.pdf  A4 poster, real fonts, ready to print
 *   gsg-bingo-poster.png  the same poster as an image, for chat apps
 *
 * Error correction is level H (30% recoverable) throughout, because this
 * gets printed, taped to a wall, and photographed at an angle in bad
 * light by 300 people in a hurry.
 */
import QRCode from 'qrcode';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_ = process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const APP = process.env.SMOKE_APP_URL ?? 'http://localhost:3000';
const OUT = join(process.cwd(), 'docs', 'qr');
const OPTS = { errorCorrectionLevel: 'H' as const, margin: 2 };

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nExporting QR assets for \x1b[1m${URL_}\x1b[0m\n`);

  const svg = await QRCode.toString(URL_, { ...OPTS, type: 'svg' });
  writeFileSync(join(OUT, 'gsg-bingo-qr.svg'), svg);
  console.log('  ✓ gsg-bingo-qr.svg');

  const png = await QRCode.toBuffer(URL_, { ...OPTS, width: 2048, type: 'png' });
  writeFileSync(join(OUT, 'gsg-bingo-qr.png'), png);
  console.log(`  ✓ gsg-bingo-qr.png       2048x2048, ${(png.length / 1024).toFixed(0)} KB`);

  // The poster is rendered from the real /admin/qr print view so the
  // printed thing is exactly what the organiser previewed, with the
  // actual fonts rather than a re-implementation of the layout.
  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    console.log('\n  ! Skipped the PDF and PNG poster: no browser available.');
    console.log('    Run `npx playwright install chromium` and try again.\n');
    return;
  }

  const ctx = await browser.newContext({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  const target = `${APP}/admin/qr`;
  try {
    await page.goto(target, { timeout: 15_000 });
  } catch {
    console.log(`\n  ! Skipped the poster: could not reach ${target}.`);
    console.log('    Start the app with `npm run dev` first.\n');
    await browser.close();
    return;
  }

  // The page reads its URL from the address bar; override it for export.
  const field = page.locator('#qr-url');
  if (await field.count()) {
    await field.fill(URL_);
  }
  await page.waitForSelector('img[alt^="QR code"]', { timeout: 20_000 });
  await page.waitForTimeout(900);

  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: join(OUT, 'gsg-bingo-poster.pdf'),
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
  });
  console.log('  ✓ gsg-bingo-poster.pdf   A4, print-ready');

  await page.emulateMedia({ media: 'screen' });
  const sheet = page.locator('.print-sheet');
  await sheet.screenshot({ path: join(OUT, 'gsg-bingo-poster.png') });
  console.log('  ✓ gsg-bingo-poster.png   2x for sharing');

  await browser.close();

  console.log(`\n  Files are in docs/qr/`);
  console.log(`  \x1b[33mRe-run this after deploying\x1b[0m so the QR points at the real URL,`);
  console.log(`  not ${URL_}.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

export {};
