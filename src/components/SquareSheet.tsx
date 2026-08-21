'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, QueuedError, send } from '@/lib/mutate';
import { newClientKey } from '@/lib/session';
import { Button, Sheet, cx, relativeTime } from './ui';
import type { BoardPost, CardSquare, PendingConfirmation } from '@/lib/types';

/**
 * What happens when you tap a square.
 *
 * The two actions are the whole matchmaking model:
 *   Request — "I need to find a person who matches this"
 *   Offer   — "this describes me, come and find me"
 * Both land on the same board; they are two sides of the same need.
 */
export function SquareSheet({
  square, existingPost, pending, onClose, onPosted, onCancelMatch, locked,
}: {
  square: CardSquare | null;
  existingPost?: BoardPost | null;
  pending?: PendingConfirmation | null;
  onClose: () => void;
  onPosted: (kind: 'request' | 'offer', postId: string) => void;
  onCancelMatch: (confirmationId: string) => Promise<void>;
  locked?: boolean;
}) {
  const [busy, setBusy] = useState<'request' | 'offer' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!square) return null;

  const post = async (kind: 'request' | 'offer') => {
    setBusy(kind);
    setError(null);
    try {
      const res = await send<{ postId: string }>(
        '/api/posts',
        { squareId: square.id, kind, note: note.trim() || undefined, clientKey: newClientKey() },
        { queue: true },
      );
      onPosted(kind, res.postId);
      setNote('');
    } catch (err) {
      if (err instanceof QueuedError) {
        setError('Saved. It will post as soon as you are back online.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not post that. Try again.');
      }
    } finally {
      setBusy(null);
    }
  };

  const title =
    square.status === 'filled' ? 'Filled' : square.status === 'pending' ? 'Waiting on a confirmation' : 'This square';

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="space-y-5">
        <p className="font-display text-xl font-semibold leading-snug">{square.criterion_text}</p>

        {square.criterion_rule !== 'honor' && (
          <p className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink-muted">
            {square.criterion_rule === 'diff_university'
              ? 'The app checks this one: your match must be from a different university.'
              : 'The app checks this one: your match must be from a different club.'}
          </p>
        )}

        {square.status === 'filled' && (
          <div className="rounded-lg border border-confirmed/50 bg-confirmed-dim px-4 py-3">
            <p className="text-sm text-ink-muted">Confirmed by</p>
            <p className="mt-0.5 font-display text-lg font-semibold text-ink">
              {square.filled_by_name ?? 'A player who has since left'}
            </p>
            {square.filled_by_university && (
              <p className="text-sm text-ink-muted">
                {square.filled_by_university} · {square.filled_by_club}
              </p>
            )}
            {square.filled_at && (
              <p className="mt-2 font-mono text-xs text-ink-faint">{relativeTime(square.filled_at)}</p>
            )}
          </div>
        )}

        {square.status === 'pending' && pending && (
          <div className="space-y-3">
            <div className="rounded-lg border border-accent/50 bg-accent-dim/25 px-4 py-3">
              <p className="text-sm text-ink-muted">Waiting for</p>
              <p className="mt-0.5 font-display text-lg font-semibold">{pending.confirmer_name}</p>
              <p className="mt-1 text-sm text-ink-muted">
                They need to tap Confirm on their phone. Give them a nudge.
              </p>
            </div>
            <Button
              variant="secondary"
              size="lg"
              busy={busy === 'cancel'}
              onClick={async () => {
                setBusy('cancel');
                try { await onCancelMatch(pending.id); onClose(); }
                finally { setBusy(null); }
              }}
            >
              Cancel and free the square
            </Button>
          </div>
        )}

        {square.status === 'empty' && !locked && (
          <>
            {existingPost ? (
              <div className="rounded-lg border border-line-strong bg-surface-2 px-4 py-3">
                <p className="text-sm text-ink-muted">
                  You already posted {existingPost.kind === 'request' ? 'a request' : 'an offer'} for this square.
                </p>
                <Link href={`/play/board?post=${existingPost.id}`} className="mt-3 inline-block">
                  <Button variant="secondary">Open the thread</Button>
                </Link>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="sq-note" className="block text-sm font-medium">
                    Add a note <span className="text-ink-faint">(optional)</span>
                  </label>
                  <input
                    id="sq-note"
                    value={note}
                    maxLength={200}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="I am by the coffee table in a red hoodie"
                    className="mt-1.5 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 outline-none placeholder:text-ink-faint focus:border-accent"
                  />
                </div>

                <div className="space-y-2">
                  <Button size="lg" busy={busy === 'request'} onClick={() => post('request')}>
                    Ask for help finding someone
                  </Button>
                  <Button variant="secondary" size="lg" busy={busy === 'offer'} onClick={() => post('offer')}>
                    This is me — offer to be a match
                  </Button>
                </div>

                <p className="text-xs leading-relaxed text-ink-muted">
                  <strong className="text-ink">Ask</strong> puts it on the board so people can come to you.{' '}
                  <strong className="text-ink">Offer</strong> tells the room this square describes you, so
                  anyone who needs it can find you.
                </p>
              </>
            )}
          </>
        )}

        {error && (
          <p
            role="alert"
            className={cx(
              'rounded-lg px-3 py-2.5 text-sm',
              error.startsWith('Saved')
                ? 'border border-line-strong bg-surface-2 text-ink-muted'
                : 'border border-bingo/40 bg-bingo-dim text-bingo-text',
            )}
          >
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
