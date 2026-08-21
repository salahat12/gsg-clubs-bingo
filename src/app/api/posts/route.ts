import { z } from 'zod';
import { body, clientKey, handler, ok, requirePlayer, rpc } from '@/lib/route';

/** Post a Request ("I need someone who matches this") or an Offer ("I match this"). */
export const POST = handler(async (req) => {
  const claims = requirePlayer(req);
  const input = await body(
    req,
    z.object({
      squareId: z.string().uuid(),
      kind: z.enum(['request', 'offer']),
      note: z.string().trim().max(200, 'Keep the note to 200 characters or fewer.').optional(),
      clientKey,
    }),
  );

  const data = await rpc<{ post_id: string; idempotent: boolean }>('rpc_create_post', {
    p_player_id: claims.playerId,
    p_square_id: input.squareId,
    p_kind: input.kind,
    p_note: input.note ?? null,
    p_client_key: input.clientKey,
  });

  return ok({ postId: data.post_id, idempotent: data.idempotent });
});
