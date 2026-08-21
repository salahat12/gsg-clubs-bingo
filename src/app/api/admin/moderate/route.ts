import { z } from 'zod';
import { body, handler, ok, requireAdmin, rpc } from '@/lib/route';

const ACTIONS = {
  hide_post:     (id: string, hidden: boolean) => ['rpc_admin_hide_post',     { p_post_id: id,  p_hidden: hidden }],
  hide_reply:    (id: string, hidden: boolean) => ['rpc_admin_hide_reply',    { p_reply_id: id, p_hidden: hidden }],
  remove_player: (id: string) => ['rpc_admin_remove_player', { p_player_id: id }],
  undo_square:   (id: string) => ['rpc_admin_undo_square',   { p_square_id: id }],
} as const;

export const POST = handler(async (req) => {
  requireAdmin(req);
  const input = await body(
    req,
    z.object({
      action: z.enum(['hide_post', 'hide_reply', 'remove_player', 'undo_square']),
      id: z.string().uuid(),
      hidden: z.boolean().optional(),
    }),
  );

  const [fn, args] = ACTIONS[input.action](input.id, input.hidden ?? true) as [string, Record<string, unknown>];
  const data = await rpc(fn, args);
  return ok({ result: data });
});
