import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The rotating scan token/code — the whole trust model for "prove the
 * other person is physically in front of you".
 *
 * A token is HMAC(SCAN_TOKEN_SECRET, playerId + bucket), where bucket is
 * the current 60-second window. It rotates every 60s and a stale token
 * stops working exactly 30s into the new window (the grace period), so a
 * screenshot forwarded on WhatsApp is useless within half a minute.
 *
 * This is authentication, not a game rule, so — like a player's own
 * session token in src/lib/token.ts — it is verified here, in the route
 * layer, not in SQL. rpc_scan_fill trusts the player id this module hands
 * it exactly as much as it trusts the caller's own id from requirePlayer:
 * both are the output of server-side verification, never a raw
 * request-body field.
 *
 * The manual 6-character code is a truncated, human-typeable slice of the
 * same signature. It carries no player id of its own — verifying one
 * means recomputing it for every live player in the event across the
 * valid buckets and checking for an exact match (see resolveScanCode).
 */

const BUCKET_SECONDS = 60;
const GRACE_SECONDS = 30;

// 32 symbols, deliberately excluding 0/O and 1/I so a code read aloud or
// scribbled on a hand is never ambiguous.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

export function currentBucket(nowMs: number): number {
  return Math.floor(nowMs / 1000 / BUCKET_SECONDS);
}

/** Seconds remaining before the token/code now showing rotates. */
export function secondsUntilRotation(nowMs: number): number {
  const nowSec = Math.floor(nowMs / 1000);
  return BUCKET_SECONDS - (nowSec % BUCKET_SECONDS);
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function sigFor(playerId: string, bucket: number, secret: string): string {
  return hmacHex(secret, `${playerId}.${bucket}`);
}

/** Derive the 6-character manual code from a full hex signature. */
function codeFromSig(sigHex: string): string {
  // First 30 bits of the signature, sliced into six 5-bit groups.
  const n = (parseInt(sigHex.slice(0, 8), 16) >>> 2) & 0x3fffffff;
  let out = '';
  for (let i = CODE_LENGTH - 1; i >= 0; i--) {
    out = CODE_ALPHABET[(n >>> (i * 5)) & 0x1f] + out;
  }
  return out;
}

export type MintedScanCredential = {
  token: string;
  code: string;
  bucket: number;
  secondsRemaining: number;
};

/** Mint the current token + manual code for a player. Called every ~55s. */
export function mintScanCredential(
  playerId: string,
  secret: string,
  nowMs: number = Date.now(),
): MintedScanCredential {
  const bucket = currentBucket(nowMs);
  const sig = sigFor(playerId, bucket, secret);
  return {
    token: `${playerId}.${bucket}.${sig.slice(0, 32)}`,
    code: codeFromSig(sig),
    bucket,
    secondsRemaining: secondsUntilRotation(nowMs),
  };
}

function bucketIsValid(bucket: number, nowMs: number): boolean {
  const cur = currentBucket(nowMs);
  if (bucket === cur) return true;
  // the previous bucket's token only survives the first 30s of this one
  const nowSec = Math.floor(nowMs / 1000);
  return bucket === cur - 1 && nowSec % BUCKET_SECONDS < GRACE_SECONDS;
}

function timingSafeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Verify a full QR token (self-contained: carries its own player id). */
export function verifyScanToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [playerId, bucketStr, sig] = parts;
  const bucket = Number(bucketStr);
  if (!playerId || !Number.isInteger(bucket)) return null;
  if (!bucketIsValid(bucket, nowMs)) return null;

  const expected = sigFor(playerId, bucket, secret).slice(0, 32);
  if (!timingSafeStrEqual(sig, expected)) return null;
  return playerId;
}

/**
 * Verify a manually-typed 6-character code against a set of candidate
 * live players. There is no player id embedded in a code this short, so
 * this recomputes the expected code for every candidate across the valid
 * buckets and looks for an exact match.
 *
 * Returns:
 *  - { playerId } on exactly one match
 *  - { ambiguous: true } on more than one match (never silently picks one)
 *  - null on no match (expired or wrong)
 */
export function resolveManualCode(
  rawCode: string,
  candidatePlayerIds: string[],
  secret: string,
  nowMs: number = Date.now(),
): { playerId: string } | { ambiguous: true } | null {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LENGTH) return null;

  const cur = currentBucket(nowMs);
  const nowSec = Math.floor(nowMs / 1000);
  const buckets = nowSec % BUCKET_SECONDS < GRACE_SECONDS ? [cur, cur - 1] : [cur];

  const matches = new Set<string>();
  for (const playerId of candidatePlayerIds) {
    for (const bucket of buckets) {
      if (codeFromSig(sigFor(playerId, bucket, secret)) === code) {
        matches.add(playerId);
        break;
      }
    }
  }

  if (matches.size === 0) return null;
  if (matches.size > 1) return { ambiguous: true };
  return { playerId: [...matches][0] };
}

/** Accepts either a full QR token or a manual code and dispatches accordingly. */
export function looksLikeFullToken(raw: string): boolean {
  return raw.includes('.');
}
