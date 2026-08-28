'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePlayer } from '@/lib/player';
import { useLive, useLiveQuery } from '@/lib/live';
import { fetchBoard, fetchCard, fetchEvent, fetchMyBingos } from '@/lib/reads';
import { closestLine } from '@/lib/bingo';
import { BingoCard } from '@/components/BingoCard';
import { SquareSheet } from '@/components/SquareSheet';
import { BingoCelebration, lineLabel } from '@/components/BingoCelebration';
import { RulesCard } from '@/components/RulesCard';
import { Button, Sheet, Spinner, useToast, formatElapsed } from '@/components/ui';
import type { CardSquare } from '@/lib/types';

export default function CardPage() {
  const router = useRouter();
  const { player, signOut } = usePlayer();
  const { serverNow } = useLive();
  const toast = useToast();

  const [openSquare, setOpenSquare] = useState<CardSquare | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [celebrate, setCelebrate] = useState<{ key: string; ordinal: number } | null>(null);

  const { data: event } = useLiveQuery({ tables: ['events'], fetcher: fetchEvent });

  const { data: squares, loading } = useLiveQuery({
    tables: ['card_squares'],
    fetcher: () => (player ? fetchCard(player.id) : Promise.resolve([])),
    enabled: Boolean(player),
    deps: [player?.id],
  });

  const { data: myPosts, refetch: refetchPosts } = useLiveQuery({
    tables: ['posts'],
    fetcher: () =>
      player && event
        ? fetchBoard(event.id, { filter: 'mine', playerId: player.id, limit: 50 })
        : Promise.resolve([]),
    enabled: Boolean(player && event),
    deps: [player?.id, event?.id],
    intervalMs: 8_000,
  });

  const { data: bingos } = useLiveQuery({
    tables: ['bingos'],
    fetcher: () => (player ? fetchMyBingos(player.id) : Promise.resolve([])),
    enabled: Boolean(player),
    deps: [player?.id],
  });

  // Celebrate a line the first time we see it, not on every poll.
  const seenLines = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!bingos) return;
    if (seenLines.current === null) {
      seenLines.current = new Set(bingos.map((b) => b.line_key));
      return;
    }
    const fresh = bingos.filter((b) => !seenLines.current!.has(b.line_key));
    if (fresh.length) {
      fresh.forEach((b) => seenLines.current!.add(b.line_key));
      setCelebrate({ key: fresh[0].line_key, ordinal: seenLines.current!.size });
    }
  }, [bingos]);

  const locked = event?.status !== 'running';

  const postFor = useMemo(() => {
    const map = new Map<string, NonNullable<typeof myPosts>[number]>();
    for (const p of myPosts ?? []) {
      if (p.card_square_id && p.status === 'open') map.set(p.card_square_id, p);
    }
    return map;
  }, [myPosts]);

  const filled = useMemo(
    () =>
      Array.from({ length: 25 }, (_, i) =>
        (squares ?? []).find((s) => s.idx === i)?.status === 'filled',
      ),
    [squares],
  );

  const nearest = useMemo(() => closestLine(filled), [filled]);
  const filledCount = filled.filter(Boolean).length;

  const elapsed =
    event?.started_at && event.status !== 'waiting'
      ? Math.max(0, serverNow() - new Date(event.started_at).getTime() - Number(event.paused_ms ?? 0))
      : 0;

  if (loading && !squares?.length) {
    return (
      <div className="grid min-h-[60dvh] place-items-center">
        <Spinner className="size-6 text-accent" />
        <span className="sr-only">Loading your card</span>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-3 pt-4">
      <header className="mb-3 flex items-start justify-between gap-3 px-1">
        <div>
          <h1 className="font-display text-xl font-bold leading-tight">Your card</h1>
          <p className="text-sm text-ink-muted">
            {filledCount === 0
              ? 'Tap a square to get started.'
              : nearest && nearest.missing.length === 1
                ? 'One square from a line.'
                : nearest
                  ? `${nearest.missing.length} squares from your closest line.`
                  : 'Every line complete.'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <p className="font-mono tabular text-sm text-ink-muted" aria-label="Time since the game started">
            {formatElapsed(elapsed)}
          </p>
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            className="size-9 grid place-items-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="10" cy="10" r="2.6" />
              <path d="M10 2.2v2M10 15.8v2M17.8 10h-2M4.2 10h-2M15.5 4.5l-1.4 1.4M5.9 14.1l-1.4 1.4M15.5 15.5l-1.4-1.4M5.9 5.9L4.5 4.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <BingoCard squares={squares ?? []} onOpen={setOpenSquare} locked={locked && event?.status === 'ended'} />

      <p className="mt-4 px-1 text-center text-xs text-ink-muted">
        A square only fills when you scan someone.{' '}
        <button onClick={() => setShowRules(true)} className="text-accent underline underline-offset-2">
          How to play
        </button>
      </p>

      <SquareSheet
        square={openSquare}
        existingPost={openSquare ? postFor.get(openSquare.id) ?? null : null}
        locked={locked}
        onClose={() => setOpenSquare(null)}
        onPosted={(kind, postId) => {
          setOpenSquare(null);
          refetchPosts();
          toast.show(
            kind === 'request'
              ? 'Posted. Watch the board for replies.'
              : 'Posted. People who need this square can now find you.',
          );
          router.push(`/play/board?post=${postId}`);
        }}
      />

      {celebrate && (
        <BingoCelebration
          lineLabel={lineLabel(celebrate.key)}
          ordinal={celebrate.ordinal}
          onClose={() => setCelebrate(null)}
        />
      )}

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
          <Link href="/play/code" className="block">
            <Button variant="secondary" size="lg">My code</Button>
          </Link>
          <Link href="/play/people" className="block">
            <Button variant="secondary" size="lg">People I met</Button>
          </Link>
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
        </div>
      </Sheet>

      {toast.node}
    </div>
  );
}
