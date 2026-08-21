/**
 * The rules engine raises with a SQLSTATE and a message already written
 * for a player to read. This maps the code to an HTTP status and decides
 * whether the client's retry queue should try again.
 *
 * Codes come from db/migrations/0002_rules.sql.
 */
export const ERROR_STATUS: Record<string, number> = {
  GB100: 409, // not started
  GB101: 409, // paused
  GB102: 409, // ended
  GB103: 409, // countdown still running
  GB104: 403, // joining closed
  GB200: 429, // rate limited
  GB300: 409, // self-match
  GB301: 409, // pair cap
  GB302: 409, // same university (criterion 1)
  GB303: 409, // same club (criterion 22)
  GB304: 409, // square already filled
  GB305: 403, // not addressed to you
  GB306: 409, // already answered
  GB400: 401, // player removed
  GB401: 404, // not found
  GB402: 409, // criteria pool is not 25
  GB403: 400, // bad request
};

export type ApiFailure = { ok: false; code: string; message: string };

const GENERIC = 'Something went wrong on our side. Try that again.';

export class GameError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

type PgLike = { code?: string; message?: string; details?: string; hint?: string };

/**
 * Turn whatever came back from Supabase into a response body. A GB* code
 * carries copy meant for the player, so it is passed through verbatim.
 * Anything else is a bug on our side and gets a generic message, with the
 * real one logged for us.
 */
export function toApiFailure(err: unknown): { status: number; body: ApiFailure } {
  if (err instanceof GameError) {
    return { status: err.status, body: { ok: false, code: err.code, message: err.message } };
  }

  const e = err as PgLike;
  const code = e?.code ?? '';

  if (code in ERROR_STATUS) {
    return {
      status: ERROR_STATUS[code],
      body: { ok: false, code, message: e.message ?? GENERIC },
    };
  }

  console.error('[api] unexpected error', { code, message: e?.message, details: e?.details });
  return { status: 500, body: { ok: false, code: 'INTERNAL', message: GENERIC } };
}

/**
 * Whether the offline retry queue should replay this. A rejected rule is
 * a real answer and must not be retried forever; a timeout or a 5xx is
 * worth another go once the wifi comes back.
 */
export function isRetryable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}
