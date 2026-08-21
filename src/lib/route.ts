import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { serviceClient } from './supabase';
import { GameError, toApiFailure } from './errors';
import { verifyPlayerToken, verifyAdminToken, type PlayerClaims } from './token';

export const PLAYER_HEADER = 'x-player-token';
export const ADMIN_COOKIE = 'gsg_admin';

function secret(): string {
  const s = process.env.PLAYER_TOKEN_SECRET;
  if (!s) throw new Error('PLAYER_TOKEN_SECRET is not set');
  return s;
}

/** Verify the caller's player token, or reject the request. */
export function requirePlayer(req: NextRequest): PlayerClaims {
  const claims = verifyPlayerToken(req.headers.get(PLAYER_HEADER), secret());
  if (!claims) {
    throw new GameError('GB400', 'We could not verify your card. Join again to get a new one.', 401);
  }
  return claims;
}

export function requireAdmin(req: NextRequest): void {
  const pass = process.env.ADMIN_PASSPHRASE;
  if (!pass) throw new Error('ADMIN_PASSPHRASE is not set');
  const ok = verifyAdminToken(req.cookies.get(ADMIN_COOKIE)?.value, pass, secret());
  if (!ok) throw new GameError('GB305', 'Enter the admin passphrase to continue.', 401);
}

/** Call a rules-engine function with the service key. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await serviceClient().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/**
 * Wraps a handler so every route reports failures the same way and a
 * thrown rule becomes a clean, readable response instead of a stack trace.
 */
type RouteContext<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
};

export function handler<P extends Record<string, string> = Record<string, string>>(
  fn: (req: NextRequest, ctx: RouteContext<P>) => Promise<NextResponse>,
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<NextResponse> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      const { status, body } = toApiFailure(err);
      return NextResponse.json(body, { status });
    }
  };
}

/** Parse and validate a JSON body, rejecting with readable copy. */
export async function body<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new GameError('GB403', 'That request was malformed.', 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new GameError('GB403', first?.message ?? 'Check the form and try again.', 400);
  }
  return parsed.data;
}

export const ok = (data: unknown = {}) => NextResponse.json({ ok: true, ...(data as object) });

/** Shared field rules, so the client and server agree on what is valid. */
export const shortText = (label: string) =>
  z.string().trim().min(1, `${label} is required.`).max(60, `${label} must be 60 characters or fewer.`);

export const clientKey = z.string().min(8).max(100);

/** Exposed so /api/join can mint a token with the same secret. */
export function tokenSecret(): string {
  return secret();
}
