'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, QueuedError, send } from '@/lib/mutate';
import { newClientKey } from '@/lib/session';
import { Button, Sheet, cx, relativeTime } from './ui';
import type { BoardPost, CardSquare } from '@/lib/types';

/**
 * What happens when you tap a square.
 *
 * A square fills only one way now: scan the person, or type their code.
 * The board is a separate, purely optional finding tool — post here if
 * you cannot think of anyone in the room who matches, then go meet
 * whoever replies and scan them.
 */
export function SquareSheet({
  square, existingPost, onClose, onPosted, locked,
}: {
  square: CardSquare | null;
  existingPost?: BoardPost | null;
  onClose: () => void;
  onPosted: (kind: 'request' | 'offer', postId: string) => void;
  locked?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'request' | 'offer' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showAsk, setShowAsk] = useState(false);

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

  const title = square.status === 'filled' ? 'Filled' : 'This square';

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="space-y-5">
        <p className="font-display text-xl font-semibold leading-snug">{square.criterion_text}</p>

        {square.criterion_rule === 'diff_university' && (
          <p className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink-muted">
            The app checks this one: your match must be from a different university.
          </p>
        )}

        {square.status === 'filled' && (
          <div className="rounded-lg border border-confirmed/50 bg-confirmed-dim px-4 py-3">
            <p className="text-sm text-ink-muted">Filled by</p>
            <p className="mt-0.5 font-display text-lg font-semibold text-ink">
              {square.filled_by_name ?? 'A player who has since left'}
            </p>
            {square.filled_by_university && (
              <p className="text-sm text-ink-muted">{square.filled_by_university}</p>
            )}
            {square.filled_at && (
              <p className="mt-2 font-mono text-xs text-ink-faint">{relativeTime(square.filled_at)}</p>
            )}
          </div>
        )}

        {square.status === 'empty' && !locked && (
          <>
            <Button
              size="lg"
              onClick={() => router.push(`/play/scan?square=${square.id}`)}
            >
              Scan to fill
            </Button>

            {existingPost ? (
              <div className="rounded-lg border border-line-strong bg-surface-2 px-4 py-3">
                <p className="text-sm text-ink-muted">
                  You already posted {existingPost.kind === 'request' ? 'a request' : 'an offer'} for this square.
                </p>
                <Link href={`/play/board?post=${existingPost.id}`} className="mt-3 inline-block">
                  <Button variant="secondary">Open the thread</Button>
                </Link>
              </div>
            ) : !showAsk ? (
              <button
                type="button"
                onClick={() => setShowAsk(true)}
                className="w-full text-center text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                Can&rsquo;t think of anyone? Ask the board
              </button>
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
                  <Button variant="secondary" size="lg" busy={busy === 'request'} onClick={() => post('request')}>
                    Ask for help finding someone
                  </Button>
                  <Button variant="secondary" size="lg" busy={busy === 'offer'} onClick={() => post('offer')}>
                    This is me — offer to be a match
                  </Button>
                </div>

                <p className="text-xs leading-relaxed text-ink-muted">
                  The board is just for finding someone — posting or replying does not fill
                  anything by itself. Once you find the right person, go meet them and scan.
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
