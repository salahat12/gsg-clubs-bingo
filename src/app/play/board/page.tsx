'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePlayer } from '@/lib/player';
import { useLiveQuery } from '@/lib/live';
import { BOARD_PAGE, fetchBoard, fetchEvent, fetchRepliesFor } from '@/lib/reads';
import { ApiError, send } from '@/lib/mutate';
import { PostCard } from '@/components/PostCard';
import { Button, EmptyState, Spinner, cx, useToast } from '@/components/ui';
import type { BoardFilter, BoardPost, BoardSort } from '@/lib/types';

const FILTERS: Array<{ id: BoardFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'requests', label: 'Requests' },
  { id: 'offers', label: 'Offers' },
  { id: 'open', label: 'Open' },
  { id: 'mine', label: 'Mine' },
];

export default function BoardPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[60dvh] place-items-center"><Spinner className="size-6 text-accent" /></div>}>
      <Board />
    </Suspense>
  );
}

function Board() {
  const params = useSearchParams();
  const focusPost = params.get('post');

  const { player } = usePlayer();
  const toast = useToast();

  const [filter, setFilter] = useState<BoardFilter>('all');
  const [sort, setSort] = useState<BoardSort>('newest');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pageSize, setPageSize] = useState(BOARD_PAGE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedFocusPost, setExpandedFocusPost] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(id);
  }, [search]);

  // A post named in the URL (arrived at from the card) auto-expands once.
  // Adjusted during render rather than in an effect — it needs to apply
  // before the first paint of this thread, not one frame after.
  if (focusPost && focusPost !== expandedFocusPost) {
    setExpandedFocusPost(focusPost);
    setExpanded((e) => new Set(e).add(focusPost));
  }

  const { data: event } = useLiveQuery({ tables: ['events'], fetcher: fetchEvent });

  const { data: posts, loading, refetch: refetchBoard } = useLiveQuery({
    tables: ['posts'],
    fetcher: () =>
      event
        ? fetchBoard(event.id, { filter, sort, search: debounced, playerId: player?.id, limit: pageSize })
        : Promise.resolve([] as BoardPost[]),
    enabled: Boolean(event),
    deps: [event?.id, filter, sort, debounced, pageSize, player?.id],
  });

  const expandedIds = useMemo(() => [...expanded], [expanded]);

  const { data: replies, refetch: refetchReplies } = useLiveQuery({
    tables: ['replies'],
    fetcher: () => fetchRepliesFor(expandedIds),
    enabled: expandedIds.length > 0,
    deps: [expandedIds.join(',')],
  });

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onClosePost = useCallback(
    async (postId: string) => {
      try {
        await send(`/api/posts/${postId}/close`, {});
        toast.show('Closed. It stays on the board but nobody can reply.');
        refetchBoard();
      } catch (err) {
        toast.fail(err instanceof ApiError ? err.message : 'Could not close that post.');
      }
    },
    [toast, refetchBoard],
  );

  const locked = event?.status !== 'running';
  const list = useMemo(() => posts ?? [], [posts]);

  // Put a post arrived at from the card at the top, so tapping "open the
  // thread" does not drop someone into the middle of a busy feed.
  const ordered = useMemo(() => {
    if (!focusPost) return list;
    const hit = list.find((p) => p.id === focusPost);
    return hit ? [hit, ...list.filter((p) => p.id !== focusPost)] : list;
  }, [list, focusPost]);

  return (
    <div className="mx-auto w-full max-w-lg px-3 pt-4">
      <header className="px-1">
        <h1 className="font-display text-xl font-bold leading-tight">Requests &amp; offers</h1>
        <p className="text-sm text-ink-muted">
          Post what you need, answer what you can, then go and meet them.
        </p>
      </header>

      <div className="sticky top-0 z-30 -mx-3 mt-3 bg-canvas/95 px-3 pb-2 pt-2 backdrop-blur">
        <label htmlFor="board-search" className="sr-only">Search the board</label>
        <input
          id="board-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search squares — hackathon, languages, Gaza…"
          className="w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 outline-none placeholder:text-ink-faint focus:border-accent"
        />

        <div className="mt-2 flex items-center gap-2">
          {/* The chip row scrolls on narrow phones. The fade on the right
              edge is what makes that legible as "there is more" rather
              than as a clipped layout. */}
          <div className="relative min-w-0 flex-1">
            <div
              role="group"
              aria-label="Filter posts"
              className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pr-4"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => { setFilter(f.id); setPageSize(BOARD_PAGE); }}
                  aria-pressed={filter === f.id}
                  className={cx(
                    'shrink-0 rounded-full border px-2.5 py-1.5 text-[13px]',
                    filter === f.id
                      ? 'border-accent bg-accent font-medium text-accent-ink'
                      : 'border-line-strong text-ink-muted hover:text-ink',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-canvas to-transparent"
            />
          </div>

          <button
            onClick={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong text-ink-muted hover:text-ink"
            aria-label={`Sorted by ${sort} first. Switch to ${sort === 'newest' ? 'oldest' : 'newest'} first.`}
            title={sort === 'newest' ? 'Newest first' : 'Oldest first'}
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M6 3v14M6 17l-3-3M6 17l3-3" strokeLinecap="round" strokeLinejoin="round"
                className={cx(sort === 'oldest' && 'origin-center -scale-y-100')} />
              <path d="M12 6h6M12 10h5M12 14h4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {loading && !posts ? (
        <div className="grid min-h-[40dvh] place-items-center">
          <Spinner className="size-6 text-accent" />
          <span className="sr-only">Loading the board</span>
        </div>
      ) : ordered.length === 0 ? (
        <EmptyState
          title={
            debounced ? 'Nothing matches that search'
            : filter === 'mine' ? 'You have not posted yet'
            : 'The board is empty'
          }
        >
          {debounced
            ? 'Try a shorter word, or clear the search to see everything.'
            : filter === 'mine'
              ? 'Open your card, tap a square, and ask for help. It shows up here.'
              : 'Be first. Open your card, tap a square, and ask for help finding someone.'}
        </EmptyState>
      ) : (
        <>
          <ul className="mt-2 space-y-2.5">
            {ordered.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                replies={expanded.has(post.id) ? replies?.[post.id] ?? [] : undefined}
                expanded={expanded.has(post.id)}
                onToggle={() => { toggle(post.id); refetchReplies(); }}
                myPlayerId={player?.id ?? null}
                onClose={onClosePost}
                locked={locked}
              />
            ))}
          </ul>

          {list.length >= pageSize && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={() => setPageSize((n) => n + BOARD_PAGE)}>
                Show more
              </Button>
            </div>
          )}
        </>
      )}

      {toast.node}
    </div>
  );
}
