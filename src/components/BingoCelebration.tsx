'use client';

import { useEffect } from 'react';
import { Button } from './ui';

/**
 * The second signature moment. Deliberately loud — it is the only place
 * in the app that uses watermelon at full strength, and the only full
 * screen takeover.
 */
export function BingoCelebration({
  lineLabel, ordinal, onClose,
}: { lineLabel: string; ordinal: number; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 9_000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-canvas/96 backdrop-blur px-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="bingo-title"
    >
      <div className="text-center max-w-sm">
        <div aria-hidden className="mx-auto mb-6 flex justify-center gap-1.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="size-3 rounded-full bg-bingo animate-star-in"
              style={{ animationDelay: `${i * 70}ms` }}
            />
          ))}
        </div>

        <h2 id="bingo-title" className="font-display text-[4rem] leading-none font-bold text-bingo">
          BINGO
        </h2>

        <p className="mt-4 text-lg text-ink">
          {ordinal === 1 ? 'You completed a line.' : `That is line number ${ordinal}.`}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{lineLabel}</p>

        <p className="mt-6 text-[15px] text-ink-muted leading-relaxed">
          {ordinal === 1
            ? 'You are on the leaderboard. Keep going — every extra line is a tiebreaker.'
            : 'Keep going. Extra lines break ties on the leaderboard.'}
        </p>

        <Button className="mt-6" size="lg" onClick={onClose}>
          Back to my card
        </Button>
      </div>
    </div>
  );
}

export function lineLabel(key: string): string {
  const [kind, n] = key.split(':');
  const i = Number(n) + 1;
  if (kind === 'row') return `Row ${i}, all five confirmed.`;
  if (kind === 'col') return `Column ${i}, all five confirmed.`;
  return `Diagonal ${i}, all five confirmed.`;
}
