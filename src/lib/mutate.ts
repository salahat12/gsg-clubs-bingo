'use client';

import { STORAGE } from './config';
import { isRetryable } from './errors';
import { getToken } from './session';

/**
 * Writes, and what happens when the venue wifi drops halfway through one.
 *
 * Every queueable mutation carries a client key that is unique per player,
 * and the database has a UNIQUE constraint on it. That is what makes a
 * retry safe: replaying a request that actually succeeded returns the
 * original row instead of creating a second one. Without it, "post again
 * when the connection comes back" would double-post half the board.
 */
export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thrown when we could not reach the server but have saved the intent. */
export class QueuedError extends Error {
  constructor(message = 'Saved. We will send it as soon as you are back online.') {
    super(message);
    this.name = 'QueuedError';
  }
}

type Queued = {
  id: string;
  path: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
};

const listeners = new Set<(n: number) => void>();

function loadQueue(): Queued[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE.queue) ?? '[]') as Queued[];
  } catch {
    return [];
  }
}

function saveQueue(q: Queued[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE.queue, JSON.stringify(q));
  } catch {
    /* ignore */
  }
  listeners.forEach((cb) => cb(q.length));
}

export function onQueueChange(cb: (n: number) => void): () => void {
  listeners.add(cb);
  cb(loadQueue().length);
  return () => listeners.delete(cb);
}

export const queueLength = () => loadQueue().length;

async function post(path: string, payload: unknown): Promise<Response> {
  const token = getToken();
  return fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-player-token': token } : {}),
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Send a write.
 *
 * `queue: true` means "this is worth replaying if the network is down" —
 * posts and replies. Match confirmations deliberately do not queue: they
 * are a live social moment, and silently confirming a match ten minutes
 * later would be worse than telling someone to tap it again.
 */
export async function send<T = unknown>(
  path: string,
  payload: unknown,
  opts: { queue?: boolean } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await post(path, payload);
  } catch {
    if (opts.queue) {
      enqueue(path, payload);
      throw new QueuedError();
    }
    throw new ApiError('OFFLINE', 'You appear to be offline. Try again in a moment.', 0);
  }

  if (res.ok) return (await res.json()) as T;

  const failure = await res.json().catch(() => ({}));
  if (opts.queue && isRetryable(res.status)) {
    enqueue(path, payload);
    throw new QueuedError();
  }
  throw new ApiError(
    (failure as { code?: string }).code ?? 'INTERNAL',
    (failure as { message?: string }).message ?? 'That did not work. Try again.',
    res.status,
  );
}

function enqueue(path: string, payload: unknown): void {
  const q = loadQueue();
  q.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    path,
    payload,
    createdAt: Date.now(),
    attempts: 0,
  });
  saveQueue(q);
}

let flushing = false;

/**
 * Replay everything we saved while offline, oldest first. A rejected item
 * is dropped rather than retried forever: a 4xx is the server's real
 * answer, and the rules that produce one will not change by trying again.
 */
export async function flushQueue(): Promise<void> {
  if (flushing || typeof navigator === 'undefined' || !navigator.onLine) return;
  flushing = true;
  try {
    let q = loadQueue();
    while (q.length) {
      const item = q[0];
      try {
        const res = await post(item.path, item.payload);
        if (!res.ok && isRetryable(res.status)) {
          item.attempts += 1;
          if (item.attempts < 8) { saveQueue(q); return; }
        }
      } catch {
        item.attempts += 1;
        if (item.attempts < 8) { saveQueue(q); return; }
      }
      q = q.slice(1);
      saveQueue(q);
    }
  } finally {
    flushing = false;
  }
}

/** Start the background flusher. Safe to call more than once. */
export function startQueueFlusher(): () => void {
  if (typeof window === 'undefined') return () => {};
  const tick = () => void flushQueue();
  const id = setInterval(tick, 8_000);
  window.addEventListener('online', tick);
  tick();
  return () => {
    clearInterval(id);
    window.removeEventListener('online', tick);
  };
}
