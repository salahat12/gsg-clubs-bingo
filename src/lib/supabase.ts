import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * The browser client. Holds the anon key, which ships in the bundle by
 * design: it can read public game state and write nothing at all. Every
 * write policy is absent and EXECUTE on the rules engine is revoked, so
 * possessing this key gets you exactly what the leaderboard already shows.
 * See db/migrations/0007_rls.sql.
 */
let browser: SupabaseClient | null = null;

export function browserClient(): SupabaseClient {
  if (!browser) {
    browser = createClient(URL_, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 5 } },
      global: { headers: { 'x-application-name': 'gsg-bingo' } },
    });
  }
  return browser;
}

/**
 * The server client. Holds the service role key, bypasses RLS, and is the
 * only thing allowed to call the rules engine. Never import this into a
 * client component — the key would end up in the bundle.
 */
export function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(URL_, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isConfigured(): boolean {
  return Boolean(URL_ && ANON);
}
