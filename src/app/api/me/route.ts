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

  type Row = {
    id: string;
    display_name: string;
    university_value: string;
    university_other_text: string | null;
    joined_late: boolean;
    removed_at: string | null;
    event_id: string;
    cards: { id: string }[] | { id: string } | null;
    universities: { label: string }[] | { label: string } | null;
  };

  const { data, error } = (await serviceClient()
    .from('players')
    .select(
      'id, display_name, university_value, university_other_text, ' +
        'joined_late, removed_at, event_id, cards(id), universities(label)',
    )
    .eq('id', claims.playerId)
    .maybeSingle()) as { data: Row | null; error: { message: string } | null };

  if (error) throw error;

  if (!data || data.removed_at) {
    return NextResponse.json(
      { ok: false, code: 'GB400', message: 'That card is no longer active. Join again to get a new one.' },
      { status: 401 },
    );
  }

  const card = Array.isArray(data.cards) ? data.cards[0] : data.cards;
  const uni = Array.isArray(data.universities) ? data.universities[0] : data.universities;
  const university =
    data.university_value === 'other'
      ? (data.university_other_text ?? 'Other')
      : ((uni as { label: string } | null)?.label ?? data.university_value);

  return NextResponse.json({
    ok: true,
    player: {
      id: data.id,
      cardId: (card as { id: string } | null)?.id ?? null,
      eventId: data.event_id,
      displayName: data.display_name,
      universityValue: data.university_value,
      university,
      joinedLate: data.joined_late,
    },
  });
});
