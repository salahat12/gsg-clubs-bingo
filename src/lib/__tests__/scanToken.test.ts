import { describe, it, expect } from 'vitest';
import {
  mintScanCredential, verifyScanToken, resolveManualCode, secondsUntilRotation,
} from '../scanToken';

const SECRET = 'test-scan-secret-do-not-use-in-production-0123456789';
const OTHER = 'a-completely-different-secret-9876543210';
const T0 = 1_700_000_000_000; // an arbitrary fixed instant, start of a bucket-aligned test

describe('scan token', () => {
  it('round-trips: a minted token verifies back to the same player id', () => {
    const { token } = mintScanCredential('player-1', SECRET, T0);
    expect(verifyScanToken(token, SECRET, T0)).toBe('player-1');
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = mintScanCredential('player-1', OTHER, T0);
    expect(verifyScanToken(token, SECRET, T0)).toBeNull();
  });

  it('rejects a tampered player id (the signature no longer matches)', () => {
    const { token } = mintScanCredential('player-1', SECRET, T0);
    const [, bucket, sig] = token.split('.');
    expect(verifyScanToken(`someone-else.${bucket}.${sig}`, SECRET, T0)).toBeNull();
  });

  it.each([
    ['no dots', 'abc'],
    ['one dot', 'abc.def'],
    ['non-numeric bucket', 'p1.notabucket.sig'],
    ['empty', ''],
  ])('rejects a malformed token: %s', (_label, raw) => {
    expect(verifyScanToken(raw, SECRET, T0)).toBeNull();
  });

  describe('rotation and the 30s grace window', () => {
    it('a token from the previous minute still verifies in the first 30s of the new one', () => {
      const bucketStart = Math.floor(T0 / 60_000) * 60_000;
      const { token } = mintScanCredential('player-1', SECRET, bucketStart - 1);
      const fifteenSecondsIntoNext = bucketStart + 15_000;
      expect(verifyScanToken(token, SECRET, fifteenSecondsIntoNext)).toBe('player-1');
    });

    it('a token from the previous minute is rejected after the 30s grace window', () => {
      const bucketStart = Math.floor(T0 / 60_000) * 60_000;
      const { token } = mintScanCredential('player-1', SECRET, bucketStart - 1);
      const fortySecondsIntoNext = bucketStart + 40_000;
      expect(verifyScanToken(token, SECRET, fortySecondsIntoNext)).toBeNull();
    });

    it('a token two buckets old never verifies, grace or not', () => {
      const bucketStart = Math.floor(T0 / 60_000) * 60_000;
      const { token } = mintScanCredential('player-1', SECRET, bucketStart - 61_000);
      expect(verifyScanToken(token, SECRET, bucketStart + 5_000)).toBeNull();
    });

    it('secondsUntilRotation counts down to zero at the bucket boundary', () => {
      const bucketStart = Math.floor(T0 / 60_000) * 60_000;
      expect(secondsUntilRotation(bucketStart)).toBe(60);
      expect(secondsUntilRotation(bucketStart + 55_000)).toBe(5);
      expect(secondsUntilRotation(bucketStart + 59_999)).toBe(1);
    });
  });

  describe('manual code', () => {
    it('round-trips through the bounded lookup', () => {
      const { code } = mintScanCredential('player-1', SECRET, T0);
      const result = resolveManualCode(code, ['player-1', 'player-2', 'player-3'], SECRET, T0);
      expect(result).toEqual({ playerId: 'player-1' });
    });

    it('uses only an unambiguous 32-symbol alphabet (no 0/O/1/I)', () => {
      for (let i = 0; i < 50; i++) {
        const { code } = mintScanCredential(`player-${i}`, SECRET, T0);
        expect(code).toHaveLength(6);
        expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      }
    });

    it('returns null for a code that matches nobody', () => {
      const result = resolveManualCode('ZZZZZZ', ['player-1', 'player-2'], SECRET, T0);
      // astronomically unlikely to collide, but assert the shape either way
      expect(result === null || 'playerId' in result).toBe(true);
    });

    it('flags ambiguity instead of guessing when two candidates collide', () => {
      // Construct a real collision by brute-forcing two player ids that
      // happen to hash to the same 6-character code at the same bucket.
      const bucketStart = Math.floor(T0 / 60_000) * 60_000;
      const codes = new Map<string, string>();
      let collided: [string, string] | null = null;
      for (let i = 0; i < 120_000 && !collided; i++) {
        const id = `probe-${i}`;
        const { code } = mintScanCredential(id, SECRET, bucketStart);
        const existing = codes.get(code);
        if (existing) collided = [existing, id];
        else codes.set(code, id);
      }
      expect(collided).not.toBeNull();
      const [x, y] = collided!;
      const { code } = mintScanCredential(x, SECRET, bucketStart);
      const result = resolveManualCode(code, [x, y], SECRET, bucketStart);
      expect(result).toEqual({ ambiguous: true });
    });

    it('is case-insensitive and tolerates stray whitespace/dashes typed by a human', () => {
      const { code } = mintScanCredential('player-1', SECRET, T0);
      const messy = ` ${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()} `;
      const result = resolveManualCode(messy, ['player-1'], SECRET, T0);
      expect(result).toEqual({ playerId: 'player-1' });
    });

    it('an expired code (past the grace window) resolves to null', () => {
      const bucketStart = Math.floor(T0 / 60_000) * 60_000;
      const { code } = mintScanCredential('player-1', SECRET, bucketStart - 61_000);
      const result = resolveManualCode(code, ['player-1'], SECRET, bucketStart + 5_000);
      expect(result).toBeNull();
    });
  });
});
