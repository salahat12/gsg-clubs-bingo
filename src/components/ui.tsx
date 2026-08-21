'use client';

import { useEffect, useId, useRef, useState } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ button
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  busy?: boolean;
};

export function Button({
  variant = 'primary', size = 'md', busy, className, children, disabled, ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium ' +
    'transition-[background-color,border-color,opacity] disabled:opacity-45 ' +
    'disabled:cursor-not-allowed select-none';
  // 44px minimum, because this is used one-handed on a phone in a crowd
  const sizes = { md: 'min-h-11 px-4 text-[15px]', lg: 'min-h-13 px-5 text-base w-full' };
  const variants = {
    primary:   'bg-accent text-accent-ink hover:bg-accent/90 active:bg-accent/80',
    secondary: 'bg-surface-2 text-ink border border-line-strong hover:bg-surface-3',
    ghost:     'text-ink-muted hover:text-ink hover:bg-surface-2',
    danger:    'bg-bingo-dim text-bingo-text border border-bingo/40 hover:bg-bingo/25',
  };
  return (
    <button
      className={cx(base, sizes[size], variants[variant], className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block size-4 shrink-0 rounded-full border-2 border-current',
        'border-r-transparent animate-spin',
        className,
      )}
    />
  );
}

// ------------------------------------------------------------------- field
type FieldProps = {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
};

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errId} role="alert" className="text-sm text-bingo-text">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg bg-surface-2 border border-line-strong px-3 py-2.5 ' +
  'text-ink placeholder:text-ink-faint outline-none ' +
  'focus:border-accent aria-[invalid=true]:border-bingo';

// ------------------------------------------------------------------- sheet
/**
 * A bottom sheet. Traps focus, closes on Escape and on backdrop tap, and
 * restores focus to whatever opened it — the card grid is a 25-target
 * surface and losing your place after every square would be miserable.
 */
export function Sheet({
  open, onClose, title, children, footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !panel.current) return;

      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // focus the panel itself rather than the first control, so a screen
    // reader announces the title before the actions
    requestAnimationFrame(() => panel.current?.focus());

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      returnTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div
        className="absolute inset-0 bg-canvas/80 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'relative w-full sm:max-w-lg max-h-[88dvh] overflow-y-auto outline-none',
          'bg-surface border-t sm:border border-line-strong',
          'rounded-t-2xl sm:rounded-2xl animate-rise-in safe-bottom',
        )}
      >
        <div className="sticky top-0 bg-surface/95 backdrop-blur border-b border-line px-4 py-3 flex items-start gap-3">
          <h2 id={titleId} className="flex-1 font-display text-lg font-semibold leading-tight">
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 -m-1 p-1 size-9 grid place-items-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-2"
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 bg-surface/95 backdrop-blur border-t border-line px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- empty state
/**
 * Empty states say what to do next. "No data" tells a player nothing at a
 * loud event where they have thirty seconds of attention.
 */
export function EmptyState({
  title, children, action,
}: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      {children && <p className="mt-1.5 text-sm text-ink-muted max-w-sm mx-auto">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------------- toast
export function useToast() {
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(id);
  }, [toast]);

  const node = toast ? (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] max-w-[90vw]',
        'rounded-lg px-4 py-2.5 text-sm shadow-lg animate-rise-in border',
        toast.tone === 'ok'
          ? 'bg-surface-2 border-line-strong text-ink'
          : 'bg-bingo-dim border-bingo/40 text-bingo-text',
      )}
    >
      {toast.text}
    </div>
  ) : null;

  return {
    node,
    show: (text: string) => setToast({ text, tone: 'ok' }),
    fail: (text: string) => setToast({ text, tone: 'bad' }),
  };
}

// ------------------------------------------------------------------ time
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** m:ss.t (or h:mm:ss). Rendered in tabular figures so the leaderboard
 *  columns do not jitter as the digits change. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(Math.floor(rest)).padStart(2, '0')}`;
  }
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}
