import { handler, ok, requirePlayer, rpc } from '@/lib/route';

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const claims = requirePlayer(req);
  const { id } = await ctx.params;
  await rpc('rpc_close_post', { p_player_id: claims.playerId, p_post_id: id });
  return ok({ postId: id });
});
