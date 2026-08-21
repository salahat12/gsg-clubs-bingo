import { z } from 'zod';
import { EVENT_SLUG } from '@/lib/config';
import { body, handler, ok, requireAdmin, rpc } from '@/lib/route';

export const POST = handler(async (req) => {
  requireAdmin(req);
  const input = await body(
    req,
    z.object({
      action: z.enum(['start', 'pause', 'resume', 'end', 'open_join', 'close_join', 'reset']),
      // 'reset' wipes every player, card, post and BINGO, so it demands
      // the slug typed back before the database will do it.
      confirm: z.string().optional(),
      countdownSeconds: z.number().int().min(0).max(30).optional(),
    }),
  );

  if (input.action === 'start' && typeof input.countdownSeconds === 'number') {
    await rpc('rpc_admin_set_countdown', {
      p_event_slug: EVENT_SLUG,
      p_seconds: input.countdownSeconds,
    });
  }

  const data = await rpc('rpc_admin_event', {
    p_event_slug: EVENT_SLUG,
    p_action: input.action,
    p_confirm: input.confirm ?? null,
  });

  return ok({ event: data });
});
