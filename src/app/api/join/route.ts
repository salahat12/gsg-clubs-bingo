import { z } from 'zod';
import { EVENT_SLUG, UNIVERSITIES } from '@/lib/config';
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
      universityValue: shortText('University'),
      universityOtherText: z.string().trim().max(60).nullable().optional(),
    }),
  );

  const data = await rpc<JoinResult>('rpc_join', {
    p_event_slug: EVENT_SLUG,
    p_display_name: input.displayName,
    p_university_value: input.universityValue,
    p_university_other_text: input.universityValue === 'other' ? (input.universityOtherText ?? null) : null,
  });

  // The card lives server-side; this token is only the claim to it, so a
  // closed tab or a dropped connection never costs anyone their game.
  const token = signPlayerToken(
    { playerId: data.player_id, eventId: data.event_id, issuedAt: Date.now() },
    tokenSecret(),
  );

  const university =
    input.universityValue === 'other'
      ? (input.universityOtherText ?? 'Other')
      : (UNIVERSITIES.find((u) => u.value === input.universityValue)?.label ?? input.universityValue);

  return ok({
    token,
    player: {
      id: data.player_id,
      cardId: data.card_id,
      eventId: data.event_id,
      displayName: input.displayName,
      universityValue: input.universityValue,
      university,
      joinedLate: data.joined_late,
    },
  });
});
