'use client';

import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { browserClient, isConfigured } from './supabase';
import { POLL_MS } from './config';

/**
 * The transport layer.
 *
 * Polling is primary and Realtime is an accelerator. Supabase's free tier
 * allows 200 concurrent Realtime connections and this event expects up to
 * 300 phones, so a third of the room would be refused a socket. Rather
 * than let those players silently fall behind, every client polls on a
 * cursor by default; the ones that do win a socket back their poll off to
 * a slow heartbeat and let push do the work.
 *
 * The same machinery is the answer to bad venue wifi: when the socket
 * drops we are already polling, and when the network goes away entirely
 * the banner says so.
 */
export type Transport = 'connecting' | 'realtime' | 'polling' | 'offline';

export const WATCHED_TABLES = [
  'events', 'players', 'posts', 'replies',
  'card_squares', 'match_confirmations', 'bingos',
] as const;
export type WatchedTable = (typeof WATCHED_TABLES)[number];

type LiveValue = {
  transport: Transport;
  /** ms to add to Date.now() to get server time. */
  clockOffset: number;
  serverNow: () => number;
  subscribe: (tables: readonly WatchedTable[], cb: () => void) => () => void;
  /** Nudge every query watching these tables to refetch now. */
  invalidate: (tables: readonly WatchedTable[]) => void;
};

const LiveContext = createContext<LiveValue | null>(null);

export function LiveProvider({ children }: { children: React.ReactNode }) {
  // Browser-only signals (navigator.onLine, whether Supabase env vars are
  // even present) are read once at init rather than corrected in an
  // effect after mount — there is nothing to synchronize, the answer is
  // just not known until the client runs.
  const [transport, setTransport] = useState<Transport>(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';
    if (!isConfigured()) return 'polling';
    return 'connecting';
  });
  const [clockOffset, setClockOffset] = useState(0);
  const listeners = useRef(new Map<WatchedTable, Set<() => void>>());

  const invalidate = useCallback((tables: readonly WatchedTable[]) => {
    for (const t of tables) listeners.current.get(t)?.forEach((cb) => cb());
  }, []);

  const subscribe = useCallback((tables: readonly WatchedTable[], cb: () => void) => {
    for (const t of tables) {
      if (!listeners.current.has(t)) listeners.current.set(t, new Set());
      listeners.current.get(t)!.add(cb);
    }
    return () => {
      for (const t of tables) listeners.current.get(t)?.delete(cb);
    };
  }, []);

  // ---- server clock, so the 3-2-1 is simultaneous across the room -----
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const sent = Date.now();
      try {
        const res = await fetch('/api/time', { cache: 'no-store' });
        const { now } = (await res.json()) as { now: number };
        const rtt = Date.now() - sent;
        // assume the response was generated halfway through the round trip
        if (!cancelled) setClockOffset(now + rtt / 2 - Date.now());
      } catch {
        /* keep the previous offset; the countdown degrades, it does not break */
      }
    };
    void sync();
    const id = setInterval(sync, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ---- browser connectivity ------------------------------------------
  useEffect(() => {
    const online = () => setTransport((t) => (t === 'offline' ? 'polling' : t));
    const offline = () => setTransport('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  // ---- try for a realtime slot ---------------------------------------
  useEffect(() => {
    // The lazy initializer above already set 'polling' in this case —
    // nothing to synchronize, just skip subscribing.
    if (!isConfigured()) return;

    const supabase = browserClient();
    let channel: RealtimeChannel | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      channel = supabase.channel(`game-${Math.random().toString(36).slice(2)}`);

      for (const table of WATCHED_TABLES) {
        channel = channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          () => invalidate([table]),
        );
      }

      channel.subscribe((status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          attempts = 0;
          setTransport((t) => (t === 'offline' ? t : 'realtime'));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // Almost always the free tier's 200-socket ceiling. Polling
          // already covers us, so back off and try again quietly.
          setTransport((t) => (t === 'offline' ? t : 'polling'));
          attempts += 1;
          if (attempts <= 6) {
            const wait = Math.min(30_000, 2_000 * 2 ** (attempts - 1));
            retry = setTimeout(() => {
              if (channel) supabase.removeChannel(channel);
              connect();
            }, wait);
          }
        }
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      if (channel) supabase.removeChannel(channel);
    };
  }, [invalidate]);

  const value = useMemo<LiveValue>(
    () => ({
      transport,
      clockOffset,
      serverNow: () => Date.now() + clockOffset,
      subscribe,
      invalidate,
    }),
    [transport, clockOffset, subscribe, invalidate],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used inside <LiveProvider>');
  return ctx;
}

type QueryState<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refetch: () => void;
};

/**
 * A live read. Polls on an interval, refetches immediately when Realtime
 * reports a change, pauses while the tab is hidden, and never overlaps
 * two in-flight fetches.
 */
export function useLiveQuery<T>(opts: {
  tables: readonly WatchedTable[];
  fetcher: () => Promise<T>;
  intervalMs?: number;
  enabled?: boolean;
  deps?: unknown[];
}): QueryState<T> {
  const { tables, fetcher, intervalMs, enabled = true, deps = [] } = opts;
  const { transport, subscribe } = useLive();

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // `loading` is derived, not tracked separately: every call site already
  // guards on `loading && !data`, and that reads identically whether
  // `loading` came from its own flag or from "no successful fetch yet" —
  // once `data` is populated it stays populated across refetches, so a
  // filter change or a poll never flips the UI back to a loading state.
  const loading = data === null && error === null;

  // Kept in sync via a layout effect rather than mutated during render:
  // reading or writing a ref's `.current` during render is unsound (React
  // may throw the render away), so the "always call the latest closure"
  // pattern has to land in an effect that runs before anything which
  // might invoke `run()` in the same commit.
  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => { fetcherRef.current = fetcher; });

  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await fetcherRef.current();
      if (mounted.current) { setData(next); setError(null); }
    } catch (err) {
      if (mounted.current) setError(err as Error);
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (enabled) void run(); }, [enabled, run, ...deps]);

  useEffect(() => enabled ? subscribe(tables, () => void run()) : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, run, subscribe, tables.join(',')]);

  useEffect(() => {
    if (!enabled) return;
    const base = intervalMs ?? (transport === 'realtime' ? POLL_MS.withRealtime : POLL_MS.live);
    const period = () => (document.visibilityState === 'hidden' ? POLL_MS.hidden : base);

    let id = setInterval(() => void run(), period());
    const onVisibility = () => {
      clearInterval(id);
      if (document.visibilityState === 'visible') void run();
      id = setInterval(() => void run(), period());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisibility); };
  }, [enabled, intervalMs, transport, run]);

  return { data, error, loading, refetch: run };
}
