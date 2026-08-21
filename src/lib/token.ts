import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Player identity without accounts or passwords.
 *
 * A player's token is an HMAC-signed claim minted server-side on join and
 * kept in localStorage, so closing a tab or dropping off the venue wifi
 * never costs someone their card. It is never sent to Supabase — only to
 * our own route handlers, which verify it before touching the rules
 * engine.
 *
 * There is deliberately no expiry: the event lasts an evening, and a
 * token that expires mid-game is a worse failure than one that outlives
 * its usefulness. Revocation is handled by players.removed_at, which
 * get_live_player() checks on every write.
 */
export type PlayerClaims = {
  playerId: string;
  eventId: string;
  issuedAt: number;
};

const b64 = (b: Buffer) => b.toString('base64url');
const sign = (payload: string, secret: string) =>
  b64(createHmac('sha256', secret).update(payload).digest());

export function signPlayerToken(claims: PlayerClaims, secret: string): string {
  const payload = b64(Buffer.from(JSON.stringify(claims)));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyPlayerToken(token: string | null | undefined, secret: string): PlayerClaims | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));

  // Compare in constant time, but only once the lengths match —
  // timingSafeEqual throws on a length mismatch.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims?.playerId !== 'string' || typeof claims?.eventId !== 'string') return null;
    return claims as PlayerClaims;
  } catch {
    return null;
  }
}

/** The admin cookie. Same mechanism, different claim, separate secret input. */
export function signAdminToken(passphrase: string, secret: string): string {
  const payload = b64(Buffer.from(JSON.stringify({ admin: true, at: Date.now() })));
  return `${payload}.${sign(payload + passphrase, secret)}`;
}

export function verifyAdminToken(
  token: string | null | undefined,
  passphrase: string,
  secret: string,
): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload + passphrase, secret));
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
