import { z } from 'zod';
import { body, clientKey, handler, ok, requirePlayer, rpc, scanTokenSecret } from '@/lib/route';
import { serviceClient } from '@/lib/supabase';
import { GameError } from '@/lib/errors';
import { looksLikeFullToken, resolveManualCode, verifyScanToken } from '@/lib/scanToken';

type ScanFillResult = {
  result: 'filled';
  square_id: string;
  scanned_id: string;
  scanned_name: string;
  scanned_university: string;
  new_lines: string[];
};

/**
 * The one call that fills a square. The scanning player comes from the
 * verified session token (requirePlayer), never the request body. The
 * scanned player comes from re-verifying the raw code here — never from a
 * player id the client asserts, and never reused from an earlier /resolve
 * call — so nothing about who gets credited for a fill is client-supplied.
 */
export const POST = handler(async (req) => {
  const claims = requirePlayer(req);
  const input = await body(
    req,
    z.object({
      code: z.string().trim().min(1).max(200),
      squareId: z.string().uuid(),
      clientKey,
    }),
  );

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

  const data = await rpc<ScanFillResult>('rpc_scan_fill', {
    p_scanning_player_id: claims.playerId,
    p_square_id: input.squareId,
    p_scanned_player_id: scannedId,
    p_client_key: input.clientKey,
  });

  return ok({ fill: data });
});
