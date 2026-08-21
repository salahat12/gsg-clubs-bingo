'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLiveQuery } from '@/lib/live';
import { fetchEvent, fetchLeaderboard } from '@/lib/reads';
import { getPlayer } from '@/lib/session';
import { Leaderboard } from '@/components/Leaderboard';
import { Spinner, cx } from '@/components/ui';

export default function PublicLeaderboardPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh grid place-items-center"><Spinner className="size-6 text-accent" /></div>}>
      <Board />
    </Suspense>
  );
}

function Board() {
  const params = useSearchParams();
  const display = params.get('display') === '1';
  // Client-only value with nothing rendered from it during the initial
  // paint (rows are still null then), so there is no hydration mismatch
  // to guard against — read it once at init instead of in an effect.
  const [meId] = useState<string | null>(() => getPlayer()?.id ?? null);

  const { data: event } = useLiveQuery({ tables: ['events'], fetcher: fetchEvent });
  const { data: rows, loading } = useLiveQuery({
    tables: ['bingos'],
    fetcher: () => (event ? fetchLeaderboard(event.id, display ? 12 : 100) : Promise.resolve([])),
    enabled: Boolean(event),
    deps: [event?.id, display],
    // The projector should feel live without hammering anything.
    intervalMs: display ? 4_000 : undefined,
  });

  /**
   * Projector mode: large type, no chrome, nothing interactive. Meant to
   * be thrown on a screen at the venue and left alone.
   */
  if (display) {
    return (
      <main className="min-h-dvh p-10">
        <header className="mb-8 text-center">
          <p className="font-mono text-lg uppercase tracking-[0.3em] text-accent">
            {event?.status === 'ended' ? 'Final' : 'Live'}
          </p>
          <h1 className="mt-2 font-display text-6xl font-bold">Leaderboard</h1>
        </header>
        <div className="mx-auto max-w-5xl">
          <Leaderboard rows={rows ?? []} display />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-4 py-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">GSG Clubs</p>
        <h1 className="mt-1.5 font-display text-2xl font-bold">Leaderboard</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {event?.status === 'ended'
            ? 'Final standings.'
            : event?.status === 'waiting'
              ? 'The game has not started yet.'
              : 'Ranked by time to a first BINGO.'}
        </p>
      </header>

      <div className="mt-6">
        {loading && !rows ? (
          <div className="grid min-h-[40dvh] place-items-center"><Spinner className="size-6 text-accent" /></div>
        ) : (
          <Leaderboard rows={rows ?? []} meId={meId} />
        )}
      </div>

      <div className={cx('mt-8 flex justify-center gap-4 text-sm')}>
        <Link href="/leaderboard?display=1" className="text-accent underline underline-offset-4">
          Projector view
        </Link>
        <Link href="/" className="text-ink-muted underline underline-offset-4 hover:text-ink">
          Join the game
        </Link>
      </div>
    </main>
  );
}
