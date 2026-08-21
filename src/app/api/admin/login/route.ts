import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { signAdminToken } from '@/lib/token';
import { ADMIN_COOKIE, body, handler, tokenSecret } from '@/lib/route';

/**
 * One passphrase, no accounts.
 *
 * Attempts are throttled per instance and the comparison is constant
 * time. A single shared secret is the right shape for a one-evening event
 * — but it is also the whole of the admin security model, so pick a
 * passphrase you would not mind seeing on a projector.
 */
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 10;

function throttled(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

function matches(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const POST = handler(async (req) => {
  const expected = process.env.ADMIN_PASSPHRASE;
  if (!expected) throw new Error('ADMIN_PASSPHRASE is not set');

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (throttled(ip)) {
    return NextResponse.json(
      { ok: false, code: 'GB200', message: 'Too many attempts. Wait five minutes.' },
      { status: 429 },
    );
  }

  const input = await body(req, z.object({ passphrase: z.string().min(1) }));

  if (!matches(input.passphrase, expected)) {
    // A small delay blunts online guessing without annoying a real admin.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json(
      { ok: false, code: 'GB305', message: 'That passphrase is not right.' },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, signAdminToken(expected, tokenSecret()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return res;
});

export const DELETE = handler(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE);
  return res;
});
