'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GRID, HEADERS, STORAGE } from '@/lib/config';
import { cellsInCompleteLines } from '@/lib/bingo';
import type { CardSquare } from '@/lib/types';
import { cx } from './ui';

/**
 * The 5x5 card. No free centre square, so a line is five real matches.
 *
 * The hard constraint here is text. At 375px each tile is about 67px
 * wide, and the longest criterion ("Find someone who joined their club
 * without knowing what they were getting into") is 74 characters. Rather
 * than clip it or reword it, each tile shrinks its own type until the
 * whole string fits its box, down to a floor of 8px — and below that
 * floor nothing is silently hidden: the full text is always in the tap
 * sheet, always in the screen-reader label, and always one toggle away in
 * List view, which exists for exactly this reason.
 */
function fitText(el: HTMLElement, min: number, max: number): void {
  let lo = min;
  let hi = max;
  let best = min;
  // binary search the largest size whose content still fits the box
  while (lo <= hi) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= el.clientHeight + 0.5) {
      best = mid;
      lo = mid + 0.25;
    } else {
      hi = mid - 0.25;
    }
  }
  el.style.fontSize = `${best}px`;
}

function useAutoFit(deps: unknown[]) {
  const root = useRef<HTMLDivElement>(null);

  const run = useCallback(() => {
    const nodes = root.current?.querySelectorAll<HTMLElement>('[data-fit]');
    if (!nodes) return;
    nodes.forEach((n) => fitText(n, 8, 13));
  }, []);

  useLayoutEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  useEffect(() => {
    if (!root.current) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    });
    ro.observe(root.current);
    return () => { ro.disconnect(); cancelAnimationFrame(frame); };
  }, [run]);

  return root;
}

type Props = {
  squares: CardSquare[];
  onOpen: (square: CardSquare) => void;
  locked?: boolean;
};

export function BingoCard({ squares, onOpen, locked }: Props) {
  // Read once at init rather than corrected after mount in an effect:
  // 'grid' is what the server would have rendered anyway (there's no SSR
  // markup for this client-only page to mismatch against), so there is
  // nothing to synchronize — just the actual value, read once.
  const [view, setView] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    try {
      const v = window.localStorage.getItem(STORAGE.cardView);
      return v === 'list' ? 'list' : 'grid';
    } catch { return 'grid'; }
  });
  const [focused, setFocused] = useState(0);

  const setViewPersisted = (v: 'grid' | 'list') => {
    setView(v);
    try { window.localStorage.setItem(STORAGE.cardView, v); } catch { /* ignore */ }
  };

  const ordered = [...squares].sort((a, b) => a.idx - b.idx);
  const filled = Array.from({ length: 25 }, (_, i) =>
    ordered.find((s) => s.idx === i)?.status === 'filled',
  );
  const winning = cellsInCompleteLines(filled);

  const gridRef = useAutoFit([ordered.length, view]);

  // Arrow-key navigation with a roving tabindex: a 25-cell grid that only
  // responds to taps is unusable with a keyboard or a switch.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowRight: 1, ArrowLeft: -1, ArrowDown: GRID, ArrowUp: -GRID,
    };
    if (e.key === 'Home') { e.preventDefault(); setFocused(0); return; }
    if (e.key === 'End') { e.preventDefault(); setFocused(24); return; }
    const delta = moves[e.key];
    if (delta === undefined) return;

    const next = focused + delta;
    // don't wrap across a row edge
    if (next < 0 || next > 24) return;
    if (Math.abs(delta) === 1 && Math.floor(next / GRID) !== Math.floor(focused / GRID)) return;

    e.preventDefault();
    setFocused(next);
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-idx="${next}"]`);
    el?.focus();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-1 pb-2">
        <p className="text-sm text-ink-muted">
          <span className="font-mono tabular text-ink">{filled.filter(Boolean).length}</span>
          <span className="text-ink-faint">/25</span> filled
        </p>
        <div role="group" aria-label="Card view" className="flex rounded-lg border border-line-strong overflow-hidden">
          {(['grid', 'list'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewPersisted(v)}
              aria-pressed={view === v}
              className={cx(
                'px-3 py-1.5 text-xs font-medium capitalize',
                view === v ? 'bg-accent text-accent-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'grid' ? (
        <div ref={gridRef}>
          <div aria-hidden="true" className="grid grid-cols-5 gap-1 pb-1">
            {HEADERS.map((h) => (
              <div key={h} className="text-center font-display text-lg font-bold text-accent leading-none">
                {h}
              </div>
            ))}
          </div>

          <div
            role="grid"
            aria-label="Your bingo card, 5 by 5"
            aria-rowcount={GRID}
            aria-colcount={GRID}
            onKeyDown={onKeyDown}
            className="grid grid-cols-5 gap-1"
          >
            {ordered.map((sq) => (
              <Tile
                key={sq.id}
                square={sq}
                inLine={winning.has(sq.idx)}
                tabIndex={sq.idx === focused ? 0 : -1}
                onOpen={() => onOpen(sq)}
                onFocus={() => setFocused(sq.idx)}
                locked={locked}
              />
            ))}
          </div>
        </div>
      ) : (
        <ol className="space-y-1.5">
          {ordered.map((sq) => (
            <ListRow
              key={sq.id}
              square={sq}
              inLine={winning.has(sq.idx)}
              onOpen={() => onOpen(sq)}
              locked={locked}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/** The label a screen reader reads: position, criterion, state, action. */
function describe(sq: CardSquare): string {
  const row = Math.floor(sq.idx / GRID) + 1;
  const col = (sq.idx % GRID) + 1;
  const where = `Row ${row}, column ${col}, ${HEADERS[sq.idx % GRID]}.`;
  const state = sq.status === 'filled' ? `Filled by ${sq.filled_by_name ?? 'someone who has since left'}.` : 'Empty.';
  const action = sq.status === 'empty' ? 'Activate to scan someone or post to the board.' : 'Activate for details.';
  return `${where} ${sq.criterion_text}. ${state} ${action}`;
}

function Tile({
  square, inLine, tabIndex, onOpen, onFocus, locked,
}: {
  square: CardSquare;
  inLine: boolean;
  tabIndex: number;
  onOpen: () => void;
  onFocus: () => void;
  locked?: boolean;
}) {
  const wasFilled = useRef(square.status === 'filled');
  const [justLanded, setJustLanded] = useState(false);

  useEffect(() => {
    if (square.status === 'filled' && !wasFilled.current) {
      setJustLanded(true);
      const t = setTimeout(() => setJustLanded(false), 500);
      wasFilled.current = true;
      return () => clearTimeout(t);
    }
    if (square.status !== 'filled') wasFilled.current = false;
  }, [square.status]);

  return (
    <button
      role="gridcell"
      data-idx={square.idx}
      tabIndex={tabIndex}
      onClick={onOpen}
      onFocus={onFocus}
      disabled={locked}
      aria-label={describe(square)}
      className={cx(
        // Portrait tiles, because the long criteria need vertical room more
        // than horizontal. The min-height is what makes criterion 15 fit on
        // a 320px phone, where the tile is only 56px wide — measured, not
        // guessed: see `npm run shots`.
        'relative aspect-[4/5] min-h-[80px] rounded-[--radius-tile] border p-1 text-left overflow-hidden',
        'transition-colors disabled:cursor-not-allowed',
        justLanded && 'animate-square-land',
        inLine
          ? 'border-bingo bg-bingo-dim'
          : square.status === 'filled'
            ? 'border-confirmed/60 bg-confirmed-dim'
            : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3',
      )}
    >
      {inLine && <span aria-hidden className="absolute inset-0 line-sweep pointer-events-none" />}

      <span
        data-fit
        aria-hidden="true"
        className={cx(
          // hyphens-auto only: `break-words` splits mid-word with no hyphen
          // ("hackatho / n"), which reads as a typo at 9px. Proper
          // hyphenation needs lang, which <html lang="en"> supplies.
          'block h-full w-full overflow-hidden leading-[1.12] hyphens-auto',
          square.status === 'filled' || inLine ? 'text-ink' : 'text-ink-muted',
        )}
        style={{ fontSize: 11 }}
      >
        {square.status === 'filled' && square.filled_by_name ? square.filled_by_name : square.criterion_text}
      </span>

      {square.status === 'filled' && (
        <span
          aria-hidden
          className={cx(
            'absolute bottom-0.5 right-0.5 grid size-4 place-items-center rounded-full',
            inLine ? 'bg-bingo text-canvas' : 'bg-confirmed text-canvas',
          )}
        >
          <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M2.5 6.2l2.4 2.4L9.5 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </button>
  );
}

function ListRow({
  square, inLine, onOpen, locked,
}: { square: CardSquare; inLine: boolean; onOpen: () => void; locked?: boolean }) {
  return (
    <li>
      <button
        onClick={onOpen}
        disabled={locked}
        aria-label={describe(square)}
        className={cx(
          'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left',
          inLine
            ? 'border-bingo bg-bingo-dim'
            : square.status === 'filled'
              ? 'border-confirmed/50 bg-confirmed-dim'
              : 'border-line bg-surface-2',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'mt-0.5 grid size-6 shrink-0 place-items-center rounded font-mono text-[10px]',
            square.status === 'filled' ? 'bg-confirmed text-canvas' : 'bg-surface-3 text-ink-muted',
          )}
        >
          {HEADERS[square.idx % GRID]}
          {Math.floor(square.idx / GRID) + 1}
        </span>
        <span className="flex-1 text-[15px] leading-snug">
          <span className={square.status === 'empty' ? 'text-ink-muted' : 'text-ink'}>
            {square.criterion_text}
          </span>
          {square.status === 'filled' && square.filled_by_name && (
            <span className="mt-0.5 block text-xs text-confirmed">
              Filled by {square.filled_by_name}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
