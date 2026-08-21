import { handler, ok, requirePlayer, rpc } from '@/lib/route';

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const claims = requirePlayer(req);
  const { id } = await ctx.params;
  await rpc('rpc_cancel_match', { p_confirmation_id: id, p_requester_id: claims.playerId });
  return ok({ confirmationId: id });
});
