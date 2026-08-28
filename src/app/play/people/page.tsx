'use client';

import { usePlayer } from '@/lib/player';
import { useLiveQuery } from '@/lib/live';
import { fetchMyFills } from '@/lib/reads';
import { EmptyState, Spinner, relativeTime } from '@/components/ui';

/**
 * People I met — the record a player actually walks away with. For most
 * people this matters more than the leaderboard: it is who they talked to,
 * not just whether they won.
 */
export default function PeoplePage() {
  const { player } = usePlayer();

  const { data: fills, loading } = useLiveQuery({
    tables: ['card_squares'],
    fetcher: () => (player ? fetchMyFills(player.id) : Promise.resolve([])),
    enabled: Boolean(player),
    deps: [player?.id],
  });

  return (
    <div className="mx-auto w-full max-w-lg px-3 pt-4">
      <header className="px-1">
        <h1 className="font-display text-xl font-bold leading-tight">People I met</h1>
        <p className="text-sm text-ink-muted">Every square, and who filled it.</p>
      </header>

      <div className="mt-4">
        {loading && !fills ? (
          <div className="grid min-h-[40dvh] place-items-center">
            <Spinner className="size-6 text-accent" />
          </div>
        ) : !fills?.length ? (
          <EmptyState title="Nobody yet">
            Scan someone from your card, and they will show up here.
          </EmptyState>
        ) : (
          <ul className="space-y-2.5">
            {fills.map((f) => (
              <li key={f.square_id} className="rounded-xl border border-line-strong bg-surface p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold leading-tight">{f.filled_by_name}</p>
                    <p className="text-sm text-ink-muted">{f.filled_by_university}</p>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-ink-faint">{relativeTime(f.filled_at)}</span>
                </div>
                <p className="mt-2 text-sm text-ink-muted">{f.criterion_text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
