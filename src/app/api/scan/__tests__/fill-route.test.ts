import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mintScanCredential } from '@/lib/scanToken';

/**
 * The scanning player must come from the verified session token, never
 * from anything in the request body — otherwise editing one field would
 * let anyone fill squares on someone else's card. This is a route-level
 * test, not a SQL one: rpc_scan_fill trusts whatever id it is given, by
 * design (see db/migrations/0004_respond.sql) — the guarantee has to live
 * here, at the one place a client-supplied id could otherwise sneak in.
 */

const SCAN_SECRET = 'route-test-scan-secret-0123456789';
const REAL_CLAIMS = { playerId: 'attacker-real-id', eventId: 'event-1', issuedAt: Date.now() };

const rpcMock = vi.fn(async (fn: string) => {
  if (fn === 'rpc_scan_fill') {
    return { result: 'filled', square_id: 's1', scanned_id: 'x', scanned_name: 'X', scanned_university: 'Y', new_lines: [] };
  }
  throw new Error(`unexpected rpc ${fn}`);
});

vi.mock('@/lib/route', async () => {
  const actual = await vi.importActual<typeof import('@/lib/route')>('@/lib/route');
  return {
    ...actual,
    requirePlayer: () => REAL_CLAIMS,
    scanTokenSecret: () => SCAN_SECRET,
    rpc: rpcMock,
  };
});

describe('POST /api/scan/fill', () => {
  beforeEach(() => { rpcMock.mockClear(); });

  it('ignores a forged scanning-player id in the body and uses the session token instead', async () => {
    const { POST } = await import('../fill/route');
    const { token: victimToken } = mintScanCredential('victim-id', SCAN_SECRET);

    const req = new NextRequest('http://localhost/api/scan/fill', {
      method: 'POST',
      body: JSON.stringify({
        code: victimToken,
        squareId: '11111111-1111-4111-8111-111111111111',
        clientKey: 'ck-12345678',
        // an attacker's attempt to override whose card gets filled —
        // this field does not even exist in the route's schema
        scanningPlayerId: 'someone-elses-id',
        playerId: 'someone-elses-id',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    expect(rpcMock).toHaveBeenCalledWith('rpc_scan_fill', expect.objectContaining({
      p_scanning_player_id: REAL_CLAIMS.playerId,
    }));
    // never the forged value, under either field name
    const args = (rpcMock.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(Object.values(args)).not.toContain('someone-elses-id');
  });
});
