import { handler, ok, requirePlayer, scanTokenSecret } from '@/lib/route';
import { mintScanCredential } from '@/lib/scanToken';

/**
 * The current scan credential for the calling player: a QR token and a
 * 6-character manual code, both good for this 60-second window. The "My
 * code" screen polls this roughly every 55s to stay ahead of rotation.
 */
export const GET = handler(async (req) => {
  const claims = requirePlayer(req);
  const cred = mintScanCredential(claims.playerId, scanTokenSecret());
  return ok(cred);
});
