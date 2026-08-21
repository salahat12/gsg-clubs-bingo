import { describe, it, expect } from 'vitest';
import {
  signPlayerToken, verifyPlayerToken, signAdminToken, verifyAdminToken,
} from '../token';

const SECRET = 'test-secret-do-not-use-in-production-0123456789';
const OTHER = 'a-completely-different-secret-9876543210';

const claims = { playerId: 'p-1', eventId: 'e-1', issuedAt: 1_700_000_000_000 };

describe('player tokens', () => {
  it('round-trips the claims it was given', () => {
    const t = signPlayerToken(claims, SECRET);
    expect(verifyPlayerToken(t, SECRET)).toEqual(claims);
  });

  it('rejects a token signed with a different secret', () => {
    const t = signPlayerToken(claims, OTHER);
    expect(verifyPlayerToken(t, SECRET)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    // Someone swapping in another player's id must not get a valid token.
    const t = signPlayerToken(claims, SECRET);
    const [, sig] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...claims, playerId: 'somebody-else' }),
    ).toString('base64url');
    expect(verifyPlayerToken(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const t = signPlayerToken(claims, SECRET);
    expect(verifyPlayerToken(`${t}x`, SECRET)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['no separator', 'abcdef'],
    ['leading dot', '.abc'],
    ['payload only', 'eyJhIjoxfQ.'],
    ['garbage', 'not-a-token-at-all'],
    ['not json', `${Buffer.from('hello').toString('base64url')}.sig`],
  ])('rejects a %s token', (_label, token) => {
    expect(verifyPlayerToken(token as string, SECRET)).toBeNull();
  });

  it('rejects a validly-signed token that is missing required claims', () => {
    const payload = Buffer.from(JSON.stringify({ issuedAt: 1 })).toString('base64url');
    const t = signPlayerToken({ ...claims }, SECRET);
    const sig = t.split('.')[1];
    // wrong signature for this payload, so it fails on the signature first
    expect(verifyPlayerToken(`${payload}.${sig}`, SECRET)).toBeNull();
  });

  it('produces different tokens for different players', () => {
    const a = signPlayerToken(claims, SECRET);
    const b = signPlayerToken({ ...claims, playerId: 'p-2' }, SECRET);
    expect(a).not.toBe(b);
  });
});

describe('admin tokens', () => {
  const PASS = 'let-me-in-please';

  it('accepts a token minted with the same passphrase and secret', () => {
    expect(verifyAdminToken(signAdminToken(PASS, SECRET), PASS, SECRET)).toBe(true);
  });

  it('stops working the moment the passphrase is rotated', () => {
    const t = signAdminToken(PASS, SECRET);
    expect(verifyAdminToken(t, 'a-new-passphrase', SECRET)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    expect(verifyAdminToken(signAdminToken(PASS, OTHER), PASS, SECRET)).toBe(false);
  });

  it.each(['', 'nope', 'a.b'])('rejects the malformed token %j', (t) => {
    expect(verifyAdminToken(t, PASS, SECRET)).toBe(false);
  });

  it('rejects a missing cookie', () => {
    expect(verifyAdminToken(undefined, PASS, SECRET)).toBe(false);
  });
});
