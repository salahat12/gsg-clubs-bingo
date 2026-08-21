'use client';

import Link from 'next/link';
import { usePlayer } from '@/lib/player';
import { useLiveQuery } from '@/lib/live';
import { fetchEvent, fetchLeaderboard } from '@/lib/reads';
import { Leaderboard } from '@/components/Leaderboard';
import { Spinner } from '@/components/ui';

export default function PlayLeaderboardPage() {
  const { player } = usePlayer();

  const { data: event } = useLiveQuery({ tables: ['events'], fetcher: fetchEvent });
  const { data: rows, loading } = useLiveQuery({
    tables: ['bingos'],
    fetcher: () => (event ? fetchLeaderboard(event.id) : Promise.resolve([])),
    enabled: Boolean(event),
    deps: [event?.id],
  });

  return (
    <div className="mx-auto w-full max-w-lg px-3 pt-4">
      <header className="px-1">
        <h1 className="font-display text-xl font-bold leading-tight">Leaderboard</h1>
        <p className="text-sm text-ink-muted">
          {event?.status === 'ended' ? 'Final standings.' : 'Ranked by time to a first BINGO.'}
        </p>
      </header>

      <div className="mt-4">
        {loading && !rows ? (
          <div className="grid min-h-[40dvh] place-items-center">
            <Spinner className="size-6 text-accent" />
            <span className="sr-only">Loading the leaderboard</span>
          </div>
        ) : (
          <Leaderboard rows={rows ?? []} meId={player?.id} />
        )}
      </div>

      <p className="mt-6 text-center text-xs text-ink-muted">
        Times run from when the organiser started the game.{' '}
        <Link href="/leaderboard?display=1" className="text-accent underline underline-offset-2">
          Projector view
        </Link>
      </p>
    </div>
  );
}
