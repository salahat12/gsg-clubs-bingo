'use client';

import { useState } from 'react';
import { ApiError, QueuedError, send } from '@/lib/mutate';
import { newClientKey } from '@/lib/session';
import { Button, Spinner, cx, relativeTime } from './ui';
import type { BoardPost, BoardReply, CardSquare } from '@/lib/types';

/**
 * One post on the Requests & Offers board, with its thread.
 *
 * Who may start a match is the subtle part. The person whose square fills
 * is always the one who initiates, and the other person always confirms —
 * so on a Request the author picks from their repliers, and on an Offer a
 * replier picks the author. That keeps a square from ever being marked by
 * the person it belongs to, whichever way round the post was written.
 */
export function PostCard({
  post, replies, expanded, onToggle, myPlayerId, mySquareForCriterion, onMatch, onClose, busyMatch, locked,
}: {
  post: BoardPost;
  replies: BoardReply[] | undefined;
  expanded: boolean;
  onToggle: () => void;
  myPlayerId: string | null;
  mySquareForCriterion: CardSquare | null;
  onMatch: (opts: { confirmerId: string; squareId: string; postId: string; name: string }) => void;
  onClose: (postId: string) => void;
  busyMatch: boolean;
  locked: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<BoardReply[]>([]);

  const mine = post.player_id === myPlayerId;
  const isRequest = post.kind === 'request';
  const allReplies = [...(replies ?? []), ...optimistic];

  // A Request post: I own the square, so I mark one of my repliers.
  const canMatchRepliers = mine && isRequest && post.status === 'open' && Boolean(post.card_square_id);
  // An Offer post from someone else: their claim fills MY square.
  const canMatchAuthor =
    !mine && !isRequest && post.status === 'open' &&
    Boolean(mySquareForCriterion && mySquareForCriterion.status === 'empty');

  const repliers = Array.from(
    new Map(allReplies.filter((r) => r.player_id !== myPlayerId).map((r) => [r.player_id, r])).values(),
  );

  const sendReply = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setNotice(null);

    // Optimistic: the reply appears instantly, because on venue wifi the
    // round trip can take seconds and this is a live conversation.
    const temp: BoardReply = {
      id: `temp-${Date.now()}`,
      post_id: post.id,
      player_id: myPlayerId ?? '',
      body: text,
      created_at: new Date().toISOString(),
      display_name: 'You',
      university: '',
      club: '',
    };
    setOptimistic((o) => [...o, temp]);
    setDraft('');

    try {
      await send(
        `/api/posts/${post.id}/replies`,
        { body: text, clientKey: newClientKey() },
        { queue: true },
      );
      setOptimistic((o) => o.filter((r) => r.id !== temp.id));
    } catch (err) {
      if (err instanceof QueuedError) {
        setNotice('Saved. It will send when you are back online.');
      } else {
        setOptimistic((o) => o.filter((r) => r.id !== temp.id));
        setDraft(text);
        setNotice(err instanceof ApiError ? err.message : 'Could not send that reply.');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <li
      className={cx(
        'rounded-xl border bg-surface',
        post.status === 'closed' ? 'border-line opacity-70' : 'border-line-strong',
      )}
    >
      <div className="p-3.5">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={cx(
              'rounded px-1.5 py-0.5 font-mono uppercase tracking-wider',
              isRequest ? 'bg-request/15 text-request' : 'bg-offer/15 text-offer',
            )}
          >
            {isRequest ? 'Needs' : 'Offers'}
          </span>
          {post.status === 'closed' && (
            <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono uppercase tracking-wider text-ink-faint">
              Matched
            </span>
          )}
          <span className="ml-auto font-mono text-ink-faint">{relativeTime(post.created_at)}</span>
        </div>

        <p className="mt-2 font-display text-[17px] font-semibold leading-snug">
          {post.criterion_text}
        </p>

        <p className="mt-1.5 text-sm text-ink-muted">
          <span className="text-ink">{post.display_name}</span>
          {mine && <span className="text-accent"> (you)</span>} · {post.university} · {post.club}
        </p>

        {post.note && (
          <p className="mt-2 rounded-lg border-l-2 border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink-muted">
            {post.note}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={onToggle}
            aria-expanded={expanded}
            className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          >
            {allReplies.length > 0
              ? `${allReplies.length} ${allReplies.length === 1 ? 'reply' : 'replies'}`
              : 'Reply'}
          </button>

          {canMatchAuthor && !locked && (
            <Button
              size="md"
              busy={busyMatch}
              onClick={() =>
                mySquareForCriterion &&
                onMatch({
                  confirmerId: post.player_id,
                  squareId: mySquareForCriterion.id,
                  postId: post.id,
                  name: post.display_name,
                })
              }
              className="ml-auto"
            >
              Mark {post.display_name} as my match
            </Button>
          )}

          {mine && post.status === 'open' && (
            <button
              onClick={() => onClose(post.id)}
              className="ml-auto text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Close this post
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line px-3.5 py-3">
          {replies === undefined ? (
            <div className="py-3 text-center"><Spinner className="size-4 text-ink-muted" /></div>
          ) : allReplies.length === 0 ? (
            <p className="py-1 text-sm text-ink-muted">
              No replies yet. Tell them where you are and what you look like.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {allReplies.map((r) => (
                <li key={r.id} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 font-display text-xs font-semibold text-ink-muted"
                  >
                    {r.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium text-ink">{r.display_name}</span>
                      {r.university && <span className="text-ink-faint"> · {r.university}</span>}
                      <span className="ml-1.5 font-mono text-xs text-ink-faint">
                        {r.id.startsWith('temp-') ? 'sending…' : relativeTime(r.created_at)}
                      </span>
                    </p>
                    <p className="text-[15px] leading-snug text-ink-muted">{r.body}</p>

                    {canMatchRepliers && !locked && (
                      <Button
                        variant="secondary"
                        className="mt-1.5"
                        busy={busyMatch}
                        onClick={() =>
                          post.card_square_id &&
                          onMatch({
                            confirmerId: r.player_id,
                            squareId: post.card_square_id,
                            postId: post.id,
                            name: r.display_name,
                          })
                        }
                      >
                        Mark {r.display_name} as my match
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!locked && post.status === 'open' && (
            <form
              onSubmit={(e) => { e.preventDefault(); void sendReply(); }}
              className="mt-3 flex gap-2"
            >
              <label htmlFor={`reply-${post.id}`} className="sr-only">
                Reply to {post.display_name}
              </label>
              <input
                id={`reply-${post.id}`}
                value={draft}
                maxLength={280}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="I am by the registration desk"
                className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 outline-none placeholder:text-ink-faint focus:border-accent"
              />
              <Button type="submit" busy={sending} disabled={!draft.trim()}>
                Send
              </Button>
            </form>
          )}

          {notice && <p role="status" className="mt-2 text-xs text-ink-muted">{notice}</p>}

          {repliers.length > 0 && canMatchRepliers && !locked && (
            <p className="mt-2 text-xs text-ink-muted">
              Only mark someone once you have actually met. They have to confirm before the square fills.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
