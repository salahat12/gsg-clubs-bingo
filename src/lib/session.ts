'use client';

import { STORAGE } from './config';
import type { StoredPlayer } from './types';

/**
 * The player's claim to their card, kept in localStorage so a refresh, an
 * accidental tab close, or a phone locking itself never costs someone
 * their game. The card itself lives server-side; this is only the key.
 */
function read<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or a full quota — the session degrades, nothing breaks */
  }
}

export const getToken = () => read<string>(STORAGE.token);
export const setToken = (t: string) => write(STORAGE.token, t);
export const getPlayer = () => read<StoredPlayer>(STORAGE.player);
export const setPlayer = (p: StoredPlayer) => write(STORAGE.player, p);

export const hasSeenRules = () => read<boolean>(STORAGE.seenRules) === true;
export const markRulesSeen = () => write(STORAGE.seenRules, true);

/** The "this is not me / start over" escape hatch. */
export function clearSession(): void {
  if (typeof window === 'undefined') return;
  for (const key of Object.values(STORAGE)) {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  }
}

export const newClientKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
