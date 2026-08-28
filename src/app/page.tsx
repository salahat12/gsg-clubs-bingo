'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePlayer } from '@/lib/player';
import { useLiveQuery } from '@/lib/live';
import { fetchEvent } from '@/lib/reads';
import { ApiError, send } from '@/lib/mutate';
import { markRulesSeen } from '@/lib/session';
import { Button, Field, Sheet, Spinner } from '@/components/ui';
import { RulesCard } from '@/components/RulesCard';
import { UNIVERSITIES } from '@/lib/config';
import type { StoredPlayer } from '@/lib/types';

export default function JoinPage() {
  const router = useRouter();
  const { player, loading: sessionLoading, signIn } = usePlayer();

  const [name, setName] = useState('');
  const [universityValue, setUniversityValue] = useState('');
  const [otherText, setOtherText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const { data: event } = useLiveQuery({
    tables: ['events'],
    fetcher: fetchEvent,
    intervalMs: 5_000,
  });

  // Already have a card? Go straight where the game is.
  useEffect(() => {
    if (sessionLoading || !player || !event) return;
    router.replace(event.status === 'waiting' ? '/lobby' : '/play/card');
  }, [player, sessionLoading, event, router]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Tell people what to call you.';
    if (!universityValue) errs.university = 'Which university are you with?';
    if (universityValue === 'other' && !otherText.trim()) errs.other = 'Type your university.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setBusy(true);
    try {
      const res = await send<{ token: string; player: StoredPlayer }>('/api/join', {
        displayName: name.trim(),
        universityValue,
        universityOtherText: universityValue === 'other' ? otherText.trim() : null,
      });
      signIn(res.player, res.token);
      markRulesSeen();
      router.replace(event?.status === 'waiting' ? '/lobby' : '/play/card');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join. Check your connection and try again.');
      setBusy(false);
    }
  };

  if (sessionLoading || player) {
    return (
      <main className="min-h-dvh grid place-items-center">
        <Spinner className="size-6 text-accent" />
        <span className="sr-only">Loading your card</span>
      </main>
    );
  }

  const joinClosed = event && !event.join_open;
  const ended = event?.status === 'ended';

  return (
    <main className="min-h-dvh flex flex-col px-5 py-8 max-w-md mx-auto w-full">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">DataCamp Scholarship</p>
        <h1 className="mt-2 font-display text-[2rem] leading-[1.1] font-bold">
          Networking Bingo
        </h1>
        <p className="mt-3 text-ink-muted leading-relaxed">
          Twenty-five squares, twenty-five people to find. You cannot tick a square
          yourself — scan someone to fill it.
        </p>
      </header>

      {ended ? (
        <div className="rounded-xl border border-line-strong bg-surface p-5">
          <h2 className="font-display font-semibold">This event has finished</h2>
          <p className="mt-1 text-sm text-ink-muted">The leaderboard is final.</p>
          <Link href="/leaderboard" className="mt-4 inline-block">
            <Button variant="secondary">See who won</Button>
          </Link>
        </div>
      ) : joinClosed ? (
        <div className="rounded-xl border border-line-strong bg-surface p-5">
          <h2 className="font-display font-semibold">Joining is closed</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Find an organiser if you have just arrived — they can reopen it.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <Field label="Your name" error={fieldErrors.name}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                value={name}
                maxLength={60}
                autoComplete="name"
                placeholder="Bara"
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg bg-surface-2 border border-line-strong px-3 py-2.5 text-ink placeholder:text-ink-faint outline-none focus:border-accent aria-[invalid=true]:border-bingo"
              />
            )}
          </Field>

          <Field label="University" error={fieldErrors.university}>
            {({ id, describedBy, invalid }) => (
              <select
                id={id}
                value={universityValue}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                onChange={(e) => setUniversityValue(e.target.value)}
                className="w-full rounded-lg bg-surface-2 border border-line-strong px-3 py-2.5 text-ink outline-none focus:border-accent aria-[invalid=true]:border-bingo"
              >
                <option value="" disabled>Pick your university</option>
                {UNIVERSITIES.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            )}
          </Field>

          {universityValue === 'other' && (
            <Field label="Which university?" error={fieldErrors.other}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  value={otherText}
                  maxLength={60}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy}
                  onChange={(e) => setOtherText(e.target.value)}
                  className="w-full rounded-lg bg-surface-2 border border-line-strong px-3 py-2.5 text-ink placeholder:text-ink-faint outline-none focus:border-accent aria-[invalid=true]:border-bingo"
                />
              )}
            </Field>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-bingo/40 bg-bingo-dim px-3 py-2.5 text-sm text-bingo-text">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" busy={busy}>
            {busy ? 'Getting your card…' : 'Get my card'}
          </Button>

          <button
            type="button"
            onClick={() => setShowRules(true)}
            className="w-full text-center text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
          >
            How to play
          </button>
        </form>
      )}

      <Sheet open={showRules} onClose={() => setShowRules(false)} title="How to play">
        <RulesCard />
      </Sheet>
    </main>
  );
}
