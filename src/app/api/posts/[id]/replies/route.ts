import { z } from 'zod';
import { body, clientKey, handler, ok, requirePlayer, rpc } from '@/lib/route';

export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const claims = requirePlayer(req);
  const { id } = await ctx.params;
  const input = await body(
    req,
    z.object({
      body: z
        .string()
        .trim()
        .min(1, 'Write something before you send it.')
        .max(280, 'Keep replies to 280 characters or fewer.'),
      clientKey,
    }),
  );

  const data = await rpc<{ reply_id: string; idempotent: boolean }>('rpc_create_reply', {
    p_player_id: claims.playerId,
    p_post_id: id,
    p_body: input.body,
    p_client_key: input.clientKey,
  });

  return ok({ replyId: data.reply_id, idempotent: data.idempotent });
});
