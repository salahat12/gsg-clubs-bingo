import { z } from 'zod';
import { body, handler, ok, requireAdmin, rpc } from '@/lib/route';

/** Edit a criterion on the day, without a redeploy. */
export const POST = handler(async (req) => {
  requireAdmin(req);
  const input = await body(
    req,
    z.object({
      criterionId: z.string().uuid(),
      text: z.string().trim().min(1).max(300).optional(),
      rule: z.enum(['honor', 'diff_university']).optional(),
    }),
  );

  const data = await rpc('rpc_admin_update_criterion', {
    p_criterion_id: input.criterionId,
    p_text: input.text ?? null,
    p_rule: input.rule ?? null,
  });

  return ok({ criterion: data });
});
