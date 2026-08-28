'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { usePlayer } from '@/lib/player';
import { useLive, useLiveQuery } from '@/lib/live';
import { fetchEvent, fetchLobbyClusters, fetchLobbyPlayers } from '@/lib/reads';
import { POLL_MS } from '@/lib/config';
import { Constellation } from '@/components/Constellation';
import { FitToBox } from '@/components/FitToBox';
import { Countdown } from '@/components/Countdown';
import { RulesCard } from '@/components/RulesCard';
import { Button, Sheet, Spinner, cx } from '@/components/ui';

export default function LobbyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh grid place-items-center">
          <Spinner className="size-6 text-accent" />
        </div>
      }
    >
      <Lobby />
    </Suspense>
  );
}

function Lobby() {
  const router = useRouter();
  const params = useSearchParams();
  const display = params.get('display') === '1';

  const { player, loading: sessionLoading, signOut } = usePlayer();
  const { serverNow } = useLive();
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { data: event } = useLiveQuery({
    tables: ['events'],
    fetcher: fetchEvent,
    intervalMs: POLL_MS.lobby,
  });

  const { data: clusters } = useLiveQuery({
    tables: ['players'],
    fetcher: () => (event ? fetchLobbyClusters(event.id) : Promise.resolve([])),
    enabled: Boolean(event),
    deps: [event?.id],
    intervalMs: POLL_MS.lobby,
  });

  const { data: players } = useLiveQuery({
    tables: ['players'],
    fetcher: () => (event ? fetchLobbyPlayers(event.id) : Promise.resolve([])),
    enabled: Boolean(event),
    deps: [event?.id],
    intervalMs: POLL_MS.lobby,
  });

  // A player without a card belongs on the join screen — but the
  // projector view is public and needs no card at all.
  useEffect(() => {
    if (!display && !sessionLoading && !player) router.replace('/');
  }, [display, sessionLoading, player, router]);

  const goToGame = useCallback(() => {
    if (!display) router.replace('/play/card');
  }, [display, router]);

  const startsAt = event?.started_at ? new Date(event.started_at).getTime() : null;
  const started = Boolean(startsAt && event?.status !== 'waiting' && serverNow() >= startsAt);
  const counting = Boolean(startsAt && event?.status === 'running' && serverNow() < startsAt);

  useEffect(() => {
    if (started && !display) goToGame();
  }, [started, display, goToGame]);

  const total = players?.length ?? 0;

  return (
    <main className={cx('flex flex-col', display ? 'h-dvh overflow-hidden p-8' : 'min-h-dvh px-4 pt-6 pb-10')}>
      <header className={cx('mx-auto w-full', display ? 'max-w-none text-center' : 'max-w-3xl')}>
        <div className={cx('flex items-start gap-4', display ? 'justify-center text-center' : 'justify-between')}>
          <div>
            <p className={cx('font-mono uppercase tracking-[0.2em] text-accent', display ? 'text-base' : 'text-xs')}>
              {event?.status === 'waiting' ? 'Waiting to start' : 'Starting now'}
            </p>
            <h1 className={cx('mt-1.5 font-display font-bold leading-tight', display ? 'text-6xl' : 'text-2xl')}>
              {event?.name ?? 'Networking Bingo'}
            </h1>
          </div>

          {!display && (
            <button
              onClick={() => setShowSettings(true)}
              aria-label="Settings"
              className="shrink-0 size-10 grid place-items-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2"
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="10" cy="10" r="2.6" />
                <path d="M10 2.2v2M10 15.8v2M17.8 10h-2M4.2 10h-2M15.5 4.5l-1.4 1.4M5.9 14.1l-1.4 1.4M15.5 15.5l-1.4-1.4M5.9 5.9L4.5 4.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        <p className={cx('mt-4 flex items-baseline gap-2 flex-wrap', display && 'justify-center')}>
          <span className={cx('font-display font-bold text-accent tabular', display ? 'text-7xl' : 'text-4xl')}>
            {total}
          </span>
          <span className={cx('text-ink-muted', display ? 'text-2xl' : 'text-base')}>
            {total === 1 ? 'person here' : 'people here'}
            {clusters && clusters.length > 0 && (
              <span className="text-ink-faint">
                {' '}across {clusters.length} {clusters.length === 1 ? 'university' : 'universities'}
              </span>
            )}
          </span>
        </p>
      </header>

      <div className={cx('mx-auto flex w-full flex-1 items-center justify-center', display ? 'min-h-0 py-8' : 'max-w-3xl py-8')}>
        {display ? (
          <FitToBox deps={[clusters?.length, players?.length]}>
            <div className="max-w-[1500px]">
              <Constellation clusters={clusters ?? []} players={players ?? []} display />
            </div>
          </FitToBox>
        ) : (
          <div className="w-full">
            <Constellation clusters={clusters ?? []} players={players ?? []} />
          </div>
        )}
      </div>

      {!display && (
        <footer className="mx-auto w-full max-w-3xl space-y-3">
          <p className="text-center text-sm text-ink-muted">
            Your card unlocks the moment an organiser starts the game. Everyone starts together.
          </p>
          <button
            onClick={() => setShowRules(true)}
            className="w-full text-center text-sm text-accent underline underline-offset-4"
          >
            How to play
          </button>
        </footer>
      )}

      {counting && event?.started_at && <Countdown startsAt={event.started_at} onDone={goToGame} />}

      <Sheet open={showRules} onClose={() => setShowRules(false)} title="How to play">
        <RulesCard />
      </Sheet>

      <Sheet open={showSettings} onClose={() => setShowSettings(false)} title="Settings">
        <div className="space-y-4">
          <div className="rounded-lg border border-line-strong bg-surface-2 px-4 py-3">
            <p className="text-sm text-ink-muted">You are playing as</p>
            <p className="mt-0.5 font-display font-semibold">{player?.displayName}</p>
            <p className="text-sm text-ink-muted">{player?.university}</p>
          </div>

          <Link href="/leaderboard" className="block">
            <Button variant="secondary" size="lg">Open the leaderboard</Button>
          </Link>

          <div>
            <Button
              variant="danger"
              size="lg"
              onClick={() => {
                if (confirm('This gives up your card and its squares. You will join as a new player. Continue?')) {
                  signOut();
                  router.replace('/');
                }
              }}
            >
              This is not me — start over
            </Button>
            <p className="mt-2 text-xs text-ink-muted">
              You will get a brand new card. Anything already filled on this one is gone.
            </p>
          </div>
        </div>
      </Sheet>
    </main>
  );
}
