'use client';

import { useEffect, useState } from 'react';
import { useLive } from '@/lib/live';
import { onQueueChange } from '@/lib/mutate';
import { cx } from './ui';

/**
 * Venue wifi is going to be bad, so the app says so out loud rather than
 * quietly showing stale data. Note there is deliberately no banner for
 * "polling": that is the normal, healthy state here — most of the room
 * will never get one of the free tier's 200 realtime sockets, and telling
 * 300 people they are degraded when they are not would be noise.
 */
export function ConnectionBanner() {
  const { transport } = useLive();
  const [queued, setQueued] = useState(0);

  useEffect(() => onQueueChange(setQueued), []);

  const offline = transport === 'offline';
  if (!offline && queued === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'fixed top-0 inset-x-0 z-[70] safe-top',
        'px-4 py-2 text-center text-sm font-medium border-b',
        offline
          ? 'bg-bingo-dim border-bingo/40 text-bingo-text'
          : 'bg-surface-2 border-line-strong text-ink',
      )}
    >
      {offline ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-bingo animate-twinkle" />
          Reconnecting. Your card is safe.
          {queued > 0 && ` ${queued} message${queued === 1 ? '' : 's'} waiting to send.`}
        </span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-accent animate-twinkle" />
          Sending {queued} saved message{queued === 1 ? '' : 's'}…
        </span>
      )}
    </div>
  );
}
