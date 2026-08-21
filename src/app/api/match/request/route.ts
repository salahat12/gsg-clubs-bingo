import { z } from 'zod';
import { body, handler, ok, requirePlayer, rpc } from '@/lib/route';

/**
 * Ask someone to vouch for you.
 *
 * The caller is always the player whose square will fill. On a Request
 * post that is the author; on an Offer post it is the replier who needs
 * the square. Either way the other person receives the prompt, so a
 * square can never be marked by the person it belongs to.
 */
export const POST = handler(async (req) => {
  const claims = requirePlayer(req);
  const input = await body(
    req,
    z.object({
      confirmerId: z.string().uuid(),
      squareId: z.string().uuid(),
      postId: z.string().uuid().nullable().optional(),
    }),
  );

  const data = await rpc<{ confirmation_id: string }>('rpc_request_match', {
    p_requester_id: claims.playerId,
    p_confirmer_id: input.confirmerId,
    p_square_id: input.squareId,
    p_post_id: input.postId ?? null,
  });

  return ok({ confirmationId: data.confirmation_id });
});
