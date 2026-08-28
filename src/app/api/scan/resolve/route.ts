import { z } from 'zod';
import { body, handler, ok, requirePlayer, rpc, scanTokenSecret } from '@/lib/route';
import { serviceClient } from '@/lib/supabase';
import { GameError } from '@/lib/errors';
import { looksLikeFullToken, resolveManualCode, verifyScanToken } from '@/lib/scanToken';

/**
 * Turn a scanned QR token or a typed 6-character code into the player it
 * belongs to — without filling anything. Used for the "person first" flow
 * (scan, then pick which square it fills) and to give immediate feedback
 * on a manually-typed code before committing to a fill.
 */
export const POST = handler(async (req) => {
  const claims = requirePlayer(req);
  const input = await body(req, z.object({ code: z.string().trim().min(1).max(200) }));

  // Rate limited here, not on the fill — this is the path someone mashes
  // while fumbling a bad-light camera or a mistyped code.
  await rpc('rpc_assert_scan_resolve_rate', { p_player_id: claims.playerId });

  let scannedId: string;
  if (looksLikeFullToken(input.code)) {
    const id = verifyScanToken(input.code, scanTokenSecret());
    if (!id) {
      throw new GameError('GB401', 'That code has expired. Ask them to show it again.', 400);
    }
    scannedId = id;
  } else {
    const { data: candidates, error } = await serviceClient()
      .from('players')
      .select('id')
      .eq('event_id', claims.eventId)
      .is('removed_at', null)
      .neq('id', claims.playerId);
    if (error) throw error;

    const result = resolveManualCode(
      input.code,
      (candidates ?? []).map((c) => c.id as string),
      scanTokenSecret(),
    );
    if (!result) {
      throw new GameError('GB401', 'That code is wrong or has expired. Ask them to show it again.', 400);
    }
    if ('ambiguous' in result) {
      throw new GameError('GB307', 'That code matches more than one person. Scan their QR code instead.', 409);
    }
    scannedId = result.playerId;
  }

  if (scannedId === claims.playerId) {
    throw new GameError('GB300', 'You cannot scan your own code.', 409);
  }

  const { data: scanned, error: scannedErr } = await serviceClient()
    .from('v_lobby_players')
    .select('id, display_name, university')
    .eq('id', scannedId)
    .eq('event_id', claims.eventId)
    .maybeSingle();
  if (scannedErr) throw scannedErr;
  if (!scanned) {
    throw new GameError('GB400', 'That player is no longer active.', 401);
  }

  return ok({
    scanned: { id: scanned.id, displayName: scanned.display_name, university: scanned.university },
  });
});
