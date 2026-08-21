import { NextResponse } from 'next/server';
import { handler, requirePlayer } from '@/lib/route';
import { serviceClient } from '@/lib/supabase';

/**
 * Bootstrap for a returning player: swap a stored token for the identity
 * behind it. Everything after this — card, board, leaderboard — is read
 * straight from Supabase by the browser, so this route is hit once per
 * session rather than once every poll.
 */
export const GET = handler(async (req) => {
  const claims = requirePlayer(req);

  const { data, error } = await serviceClient()
    .from('players')
    .select('id, display_name, university, club, joined_late, removed_at, event_id, cards(id)')
    .eq('id', claims.playerId)
    .maybeSingle();

  if (error) throw error;

  if (!data || data.removed_at) {
    return NextResponse.json(
      { ok: false, code: 'GB400', message: 'That card is no longer active. Join again to get a new one.' },
      { status: 401 },
    );
  }

  const card = Array.isArray(data.cards) ? data.cards[0] : data.cards;

  return NextResponse.json({
    ok: true,
    player: {
      id: data.id,
      cardId: (card as { id: string } | null)?.id ?? null,
      eventId: data.event_id,
      displayName: data.display_name,
      university: data.university,
      club: data.club,
      joinedLate: data.joined_late,
    },
  });
});
