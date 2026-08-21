'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clearSession, getPlayer, getToken, setPlayer as persistPlayer, setToken } from './session';
import { startQueueFlusher } from './mutate';
import type { StoredPlayer } from './types';

type PlayerValue = {
  player: StoredPlayer | null;
  /** Still checking localStorage and revalidating with the server. */
  loading: boolean;
  signIn: (player: StoredPlayer, token: string) => void;
  signOut: () => void;
};

const PlayerContext = createContext<PlayerValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  // Read localStorage synchronously at init rather than in an effect: a
  // stored card is shown on the very first render, so a refresh is never
  // a blank screen, and there is no "no session" branch left that needs
  // to flip loading off after the fact.
  const [player, setPlayerState] = useState<StoredPlayer | null>(() => getPlayer());
  const [loading, setLoading] = useState<boolean>(() => Boolean(getPlayer() && getToken()));

  useEffect(() => {
    const stored = getPlayer();
    const token = getToken();
    if (!stored || !token) return;

    // The stored card is already showing (see the initializer above).
    // Confirm with the server that it is still valid — the admin may
    // have removed this player, or the event may have reset.
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/me', { headers: { 'x-player-token': token } });
        if (cancelled) return;
        if (res.status === 401) {
          clearSession();
          setPlayerState(null);
        } else if (res.ok) {
          const data = (await res.json()) as { player: StoredPlayer };
          persistPlayer(data.player);
          setPlayerState(data.player);
        }
      } catch {
        // Offline at boot: keep the stored card. Losing someone's game
        // because the venue wifi blinked is the worst possible failure.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  useEffect(() => startQueueFlusher(), []);

  const signIn = useCallback((next: StoredPlayer, token: string) => {
    setToken(token);
    persistPlayer(next);
    setPlayerState(next);
    setLoading(false);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setPlayerState(null);
  }, []);

  const value = useMemo(
    () => ({ player, loading, signIn, signOut }),
    [player, loading, signIn, signOut],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}
