import { z } from 'zod';
import { body, handler, ok, requirePlayer, rpc } from '@/lib/route';

export type RespondResult = {
  result: 'confirmed' | 'declined';
  square_id?: string;
  requester_name?: string;
  confirmer_name?: string;
  new_lines?: string[];
  reciprocal_filled?: boolean;
  reciprocal_lines?: string[];
  note?: string | null;
};

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const claims = requirePlayer(req);
  const { id } = await ctx.params;
  const input = await body(
    req,
    z.object({
      action: z.enum(['confirm', 'decline']),
      // The confirmer may fill one of their OWN squares in the same
      // breath. They pick it; nothing is auto-filled.
      reciprocalSquareId: z.string().uuid().nullable().optional(),
    }),
  );

  const data = await rpc<RespondResult>('rpc_respond_match', {
    p_confirmation_id: id,
    p_confirmer_id: claims.playerId,
    p_action: input.action,
    p_reciprocal_square_id: input.reciprocalSquareId ?? null,
  });

  return ok({ match: data });
});
