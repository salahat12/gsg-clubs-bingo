'use client';

import { EmptyState, cx, formatElapsed } from './ui';
import type { LeaderboardRow } from '@/lib/types';

/**
 * A player appears once, at their first BINGO. Later lines become the
 * tiebreak column rather than a second row, so the ranking answers "who
 * got there first" and the second-half race stays visible next to it.
 *
 * Times are elapsed from the moment the organiser started the event, not
 * from when each player joined — which is why late joiners are marked.
 */
export function Leaderboard({
  rows, meId, display = false,
}: { rows: LeaderboardRow[]; meId?: string | null; display?: boolean }) {
  if (!rows.length) {
    return (
      <EmptyState title="No BINGO yet">
        The first person to fill a full row, column, or diagonal lands here.
      </EmptyState>
    );
  }

  return (
    <ol className={cx('space-y-2', display && 'space-y-3')}>
      {rows.map((row, i) => {
        const rank = i + 1;
        const isMe = row.player_id === meId;
        const isFirst = rank === 1;

        return (
          <li
            key={row.player_id}
            className={cx(
              'flex items-center gap-3 rounded-xl border px-3 py-2.5',
              display && 'gap-6 px-6 py-5',
              isFirst
                ? 'border-bingo bg-bingo-dim'
                : isMe
                  ? 'border-accent/60 bg-accent-dim/20'
                  : 'border-line bg-surface',
            )}
          >
            <span
              className={cx(
                'shrink-0 text-center font-display font-bold tabular',
                display ? 'w-16 text-5xl' : 'w-7 text-lg',
                isFirst ? 'text-bingo-text' : 'text-ink-muted',
              )}
              aria-label={`Rank ${rank}`}
            >
              {rank}
            </span>

            <div className="min-w-0 flex-1">
              <p className={cx('truncate font-display font-semibold', display ? 'text-3xl' : 'text-[15px]')}>
                {row.display_name}
                {isMe && <span className="ml-1.5 text-accent">(you)</span>}
              </p>
              <p className={cx('truncate text-ink-muted', display ? 'text-xl' : 'text-xs')}>
                {row.university} · {row.club}
                {row.joined_late && (
                  <span className="ml-1.5 text-ink-faint" title="Joined after the game started">
                    · joined late
                  </span>
                )}
              </p>
            </div>

            <div className="shrink-0 text-right">
              <p className={cx('font-mono tabular', display ? 'text-4xl' : 'text-[15px]',
                isFirst ? 'text-bingo-text' : 'text-ink')}>
                {formatElapsed(row.elapsed_ms)}
              </p>
              <p className={cx('text-ink-faint', display ? 'text-lg' : 'text-[11px]')}>
                {row.lines_completed} {row.lines_completed === 1 ? 'line' : 'lines'}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
