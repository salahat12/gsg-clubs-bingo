'use client';

import { useMemo, useState } from 'react';
import { usePlayer } from '@/lib/player';
import { useLiveQuery } from '@/lib/live';
import { fetchCard, fetchInbox } from '@/lib/reads';
import { ApiError, send } from '@/lib/mutate';
import { Button, Sheet, useToast, cx } from './ui';
import type { CardSquare } from '@/lib/types';
import type { RespondResult } from '@/app/api/match/[id]/respond/route';

/**
 * The confirmation prompt. This is the mechanism that stops the game
 * collapsing into everyone tapping 25 squares: a square only fills when a
 * *different* person says the two of them actually met.
 *
 * It lives at the layout level rather than on the card, because a prompt
 * can arrive while its recipient is reading the board or the leaderboard,
 * and a request to confirm is time-sensitive — the other person is
 * standing right there.
 */
export function ConfirmPrompt() {
  const { player } = usePlayer();
  const toast = useToast();
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null);
  const [picking, setPicking] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  // Tracks which prompt "picking" belongs to, so a fresh prompt never
  // inherits the previous one's step. Adjusted during render (the React-
  // recommended way to reset state when a value changes) rather than in
  // an effect: it takes effect on the very same render instead of
  // flashing the old step for one frame first.
  const [pickingFor, setPickingFor] = useState<string | null>(null);

  const { data: inbox, refetch: refetchInbox } = useLiveQuery({
    tables: ['match_confirmations'],
    fetcher: () => (player ? fetchInbox(player.id) : Promise.resolve([])),
    enabled: Boolean(player),
    deps: [player?.id],
  });

  const { data: myCard, refetch: refetchCard } = useLiveQuery({
    tables: ['card_squares'],
    fetcher: () => (player ? fetchCard(player.id) : Promise.resolve([])),
    enabled: Boolean(player),
    deps: [player?.id],
  });

  const current = useMemo(
    () => inbox?.find((c) => !dismissed.includes(c.id)) ?? null,
    [inbox, dismissed],
  );

  if (current && current.id !== pickingFor) {
    setPickingFor(current.id);
    if (picking) setPicking(false);
  }

  const openSquares = useMemo(
    () => (myCard ?? []).filter((s) => s.status === 'empty').sort((a, b) => a.idx - b.idx),
    [myCard],
  );

  if (!current || !player) return <>{toast.node}</>;

  const respond = async (action: 'confirm' | 'decline', reciprocalSquareId?: string | null) => {
    setBusy(action);
    try {
      const res = await send<{ match: RespondResult }>(
        `/api/match/${current.id}/respond`,
        { action, reciprocalSquareId: reciprocalSquareId ?? null },
      );

      if (action === 'decline') {
        toast.show('Declined. Their square is open again.');
      } else {
        const filled = res.match.reciprocal_filled;
        toast.show(
          filled
            ? `Confirmed. ${current.requester_name}'s square is filled, and so is yours.`
            : res.match.note ?? `Confirmed. ${current.requester_name} got their square.`,
        );
      }
      setDismissed((d) => [...d, current.id]);
      setPicking(false);
      refetchInbox();
      refetchCard();
    } catch (err) {
      toast.fail(err instanceof ApiError ? err.message : 'That did not go through. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Sheet
        open
        onClose={() => setDismissed((d) => [...d, current.id])}
        title={picking ? 'Fill one of your own squares' : 'Did you two meet?'}
      >
        {picking ? (
          <SquarePicker
            squares={openSquares}
            busy={busy === 'confirm'}
            onPick={(id) => respond('confirm', id)}
            onSkip={() => respond('confirm', null)}
          />
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-line-strong bg-surface-2 p-4">
              <p className="text-[15px] leading-relaxed">
                <strong className="text-ink">{current.requester_name}</strong>
                <span className="text-ink-muted"> says you two met for:</span>
              </p>
              <p className="mt-2 font-display text-lg font-semibold leading-snug text-accent">
                {current.criterion_text}
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                {current.requester_university} · {current.requester_club}
              </p>
            </div>

            <p className="text-sm text-ink-muted">
              Confirming fills their square. Only confirm if you actually spoke.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                busy={busy === 'decline'}
                onClick={() => respond('decline')}
              >
                Decline
              </Button>
              <Button
                busy={busy === 'confirm'}
                onClick={() => (openSquares.length > 0 ? setPicking(true) : respond('confirm', null))}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </Sheet>
      {toast.node}
    </>
  );
}

/**
 * After confirming, the player may fill one of their OWN squares — they
 * did just meet someone, after all. Nothing is auto-filled; they pick.
 * It costs the pair's second and last shared match, and the label says so
 * rather than letting them find out afterwards.
 */
function SquarePicker({
  squares, busy, onPick, onSkip,
}: {
  squares: CardSquare[];
  busy: boolean;
  onPick: (squareId: string) => void;
  onSkip: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        You are talking to them anyway. If they match one of your open squares, pick it and
        it fills too — this uses up the second of the two squares you can share with them.
      </p>

      <ul className="max-h-[40dvh] space-y-1.5 overflow-y-auto pr-1">
        {squares.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => setSelected(s.id)}
              aria-pressed={selected === s.id}
              className={cx(
                'w-full rounded-lg border px-3 py-2.5 text-left text-[15px] leading-snug',
                selected === s.id
                  ? 'border-accent bg-accent-dim/30 text-ink'
                  : 'border-line bg-surface-2 text-ink-muted hover:border-line-strong',
              )}
            >
              {s.criterion_text}
            </button>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onSkip} busy={busy && !selected}>
          Just confirm theirs
        </Button>
        <Button disabled={!selected} busy={busy && Boolean(selected)} onClick={() => selected && onPick(selected)}>
          Fill mine too
        </Button>
      </div>
    </div>
  );
}
