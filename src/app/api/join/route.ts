import { z } from 'zod';
import { EVENT_SLUG } from '@/lib/config';
import { signPlayerToken } from '@/lib/token';
import { body, handler, ok, rpc, shortText, tokenSecret } from '@/lib/route';

type JoinResult = {
  player_id: string;
  card_id: string;
  event_id: string;
  joined_late: boolean;
};

export const POST = handler(async (req) => {
  const input = await body(
    req,
    z.object({
      displayName: shortText('Your name'),
      university: shortText('University'),
      club: shortText('Club'),
    }),
  );

  const data = await rpc<JoinResult>('rpc_join', {
    p_event_slug: EVENT_SLUG,
    p_display_name: input.displayName,
    p_university: input.university,
    p_club: input.club,
  });

  // The card lives server-side; this token is only the claim to it, so a
  // closed tab or a dropped connection never costs anyone their game.
  const token = signPlayerToken(
    { playerId: data.player_id, eventId: data.event_id, issuedAt: Date.now() },
    tokenSecret(),
  );

  return ok({
    token,
    player: {
      id: data.player_id,
      cardId: data.card_id,
      eventId: data.event_id,
      displayName: input.displayName,
      university: input.university,
      club: input.club,
      joinedLate: data.joined_late,
    },
  });
});
