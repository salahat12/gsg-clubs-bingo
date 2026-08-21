import { NextResponse } from 'next/server';

/**
 * Server clock, for the countdown.
 *
 * Phones at a venue have arbitrarily wrong clocks. The 3-2-1 has to feel
 * simultaneous across the room, so clients measure their offset against
 * this once at boot and periodically after, then render the countdown
 * against corrected time rather than their own.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { now: Date.now() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
