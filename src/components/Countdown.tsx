'use client';

import { useEffect, useState } from 'react';
import { useLive } from '@/lib/live';

/**
 * The 3-2-1.
 *
 * It counts against server time, not the phone's clock. Handsets at a
 * venue have arbitrarily wrong clocks, and the whole point of the start
 * gate is that the race begins at the same instant for everyone — a
 * countdown that fires early on one phone would hand that person a head
 * start on the leaderboard.
 */
export function Countdown({ startsAt, onDone }: { startsAt: string; onDone: () => void }) {
  const { serverNow } = useLive();
  const [remaining, setRemaining] = useState(() => new Date(startsAt).getTime() - serverNow());

  useEffect(() => {
    const target = new Date(startsAt).getTime();
    const tick = () => {
      const left = target - serverNow();
      setRemaining(left);
      if (left <= 0) onDone();
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [startsAt, serverNow, onDone]);

  const seconds = Math.max(0, Math.ceil(remaining / 1000));

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-canvas/95 backdrop-blur-sm">
      <div className="text-center" role="status" aria-live="assertive">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-accent">Starting</p>
        <p
          key={seconds}
          className="mt-4 font-display text-[7rem] leading-none font-bold text-ink animate-square-land tabular"
        >
          {seconds > 0 ? seconds : 'GO'}
        </p>
        <p className="mt-4 text-ink-muted">Get ready to talk to strangers.</p>
      </div>
    </div>
  );
}
