'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLive, useLiveQuery } from '@/lib/live';
import { fetchBoard, fetchCriteria, fetchEvent, fetchFillFeed, fetchLobbyPlayers, fetchStats } from '@/lib/reads';
import { ApiError, send } from '@/lib/mutate';
import { Button, Field, Sheet, Spinner, cx, inputClass, relativeTime, useToast } from '@/components/ui';
import type { Criterion } from '@/lib/types';

type EventAction = 'start' | 'pause' | 'resume' | 'end' | 'open_join' | 'close_join' | 'reset';

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  // There is no "am I logged in" endpoint; the cheapest probe is an
  // action the server will reject without the cookie.
  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/admin/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'not_a_real_action' }),
      });
      setAuthed(res.status !== 401);
    })();
  }, []);

  if (authed === null) {
    return <div className="grid min-h-dvh place-items-center"><Spinner className="size-6 text-accent" /></div>;
  }
  return authed ? <Console /> : <Login onDone={() => setAuthed(true)} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await send('/api/admin/login', { passphrase });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-sm place-items-center px-5">
      <form onSubmit={submit} className="w-full space-y-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Organisers</p>
          <h1 className="mt-1.5 font-display text-2xl font-bold">Run the game</h1>
        </div>
        <Field label="Admin passphrase" error={error}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              type="password"
              value={passphrase}
              autoComplete="current-password"
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => setPassphrase(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        <Button type="submit" size="lg" busy={busy}>Unlock</Button>
      </form>
    </main>
  );
}

function Console() {
  const toast = useToast();
  const { serverNow, transport } = useLive();
  const [busy, setBusy] = useState<EventAction | null>(null);
  const [showReset, setShowReset] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [editing, setEditing] = useState<Criterion | null>(null);

  const { data: event, refetch: refetchEvent } = useLiveQuery({
    tables: ['events'], fetcher: fetchEvent, intervalMs: 3_000,
  });

  const { data: stats, refetch: refetchStats } = useLiveQuery({
    tables: ['players', 'card_squares', 'bingos', 'posts'],
    fetcher: () => (event ? fetchStats(event.id) : Promise.resolve(null)),
    enabled: Boolean(event),
    deps: [event?.id],
    intervalMs: 3_000,
  });

  const { data: criteria, refetch: refetchCriteria } = useLiveQuery({
    tables: ['events'],
    fetcher: () => (event ? fetchCriteria(event.id) : Promise.resolve([])),
    enabled: Boolean(event),
    deps: [event?.id],
    intervalMs: 30_000,
  });

  const { data: players, refetch: refetchPlayers } = useLiveQuery({
    tables: ['players'],
    fetcher: () => (event ? fetchLobbyPlayers(event.id, 500) : Promise.resolve([])),
    enabled: Boolean(event),
    deps: [event?.id],
    intervalMs: 10_000,
  });

  const { data: posts, refetch: refetchPosts } = useLiveQuery({
    tables: ['posts'],
    fetcher: () => (event ? fetchBoard(event.id, { limit: 30 }) : Promise.resolve([])),
    enabled: Boolean(event),
    deps: [event?.id],
    intervalMs: 8_000,
  });

  const { data: fills, refetch: refetchFills } = useLiveQuery({
    tables: ['card_squares'],
    fetcher: () => (event ? fetchFillFeed(event.id, 40) : Promise.resolve([])),
    enabled: Boolean(event),
    deps: [event?.id],
    intervalMs: 4_000,
  });

  const act = useCallback(
    async (action: EventAction, confirm?: string) => {
      setBusy(action);
      try {
        await send('/api/admin/event', { action, confirm });
        toast.show(`Done: ${action.replace('_', ' ')}.`);
        refetchEvent();
        refetchStats();
        if (action === 'reset') { refetchPlayers(); refetchPosts(); setShowReset(false); setResetConfirm(''); }
      } catch (err) {
        toast.fail(err instanceof ApiError ? err.message : 'That did not work.');
      } finally {
        setBusy(null);
      }
    },
    [toast, refetchEvent, refetchStats, refetchPlayers, refetchPosts],
  );

  const moderate = useCallback(
    async (action: string, id: string, hidden?: boolean) => {
      try {
        await send('/api/admin/moderate', { action, id, hidden });
        toast.show('Done.');
        refetchPlayers(); refetchPosts(); refetchStats(); refetchFills();
      } catch (err) {
        toast.fail(err instanceof ApiError ? err.message : 'That did not work.');
      }
    },
    [toast, refetchPlayers, refetchPosts, refetchStats, refetchFills],
  );

  const status = event?.status ?? 'waiting';
  const startsAt = event?.started_at ? new Date(event.started_at).getTime() : null;
  const counting = status === 'running' && startsAt !== null && serverNow() < startsAt;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-24">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Organisers</p>
          <h1 className="mt-1 font-display text-2xl font-bold">{event?.name ?? 'Event'}</h1>
        </div>
        <div className="text-right">
          <span
            className={cx(
              'inline-block rounded px-2 py-1 font-mono text-xs uppercase tracking-wider',
              status === 'running' ? 'bg-confirmed-dim text-confirmed'
                : status === 'paused' ? 'bg-accent-dim/40 text-accent'
                : status === 'ended' ? 'bg-bingo-dim text-bingo-text'
                : 'bg-surface-3 text-ink-muted',
            )}
          >
            {counting ? 'starting' : status}
          </span>
          <p className="mt-1 font-mono text-[10px] text-ink-faint">{transport}</p>
        </div>
      </header>

      {/* ------------------------------------------------- live counters */}
      <section className="mt-6" aria-label="Live counts">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Joined" value={stats?.players_joined} />
          <Stat label="Cards dealt" value={stats?.cards_dealt} />
          <Stat label="Squares filled" value={stats?.squares_filled} />
          <Stat label="BINGOs" value={stats?.players_with_bingo} accent />
          <Stat label="Lines total" value={stats?.lines_completed} />
          <Stat label="Board posts" value={stats?.posts_count} />
        </div>
      </section>

      {/* --------------------------------------------------- event controls */}
      <section className="mt-8" aria-labelledby="controls-h">
        <h2 id="controls-h" className="font-display text-lg font-semibold">Event controls</h2>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            size="lg"
            busy={busy === 'start'}
            disabled={status !== 'waiting'}
            onClick={() => act('start')}
          >
            Start the game
          </Button>

          {status === 'paused' ? (
            <Button size="lg" variant="secondary" busy={busy === 'resume'} onClick={() => act('resume')}>
              Resume
            </Button>
          ) : (
            <Button
              size="lg"
              variant="secondary"
              busy={busy === 'pause'}
              disabled={status !== 'running'}
              onClick={() => act('pause')}
            >
              Pause
            </Button>
          )}

          <Button
            size="lg"
            variant="secondary"
            busy={busy === (event?.join_open ? 'close_join' : 'open_join')}
            onClick={() => act(event?.join_open ? 'close_join' : 'open_join')}
          >
            {event?.join_open ? 'Close joining' : 'Reopen joining'}
          </Button>

          <Button
            size="lg"
            variant="danger"
            busy={busy === 'end'}
            disabled={status !== 'running' && status !== 'paused'}
            onClick={() => { if (confirm('End the game? Cards go read-only and the leaderboard is final.')) act('end'); }}
          >
            End the game
          </Button>
        </div>

        <p className="mt-2 text-xs text-ink-muted">
          Start flips every connected phone at once, after a {event?.countdown_seconds ?? 3}-second countdown.
          Nobody can fill a square until it finishes.
        </p>

        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/admin/qr" className="text-accent underline underline-offset-4">QR poster</Link>
          <Link href="/lobby?display=1" className="text-accent underline underline-offset-4">Lobby on the projector</Link>
          <Link href="/leaderboard?display=1" className="text-accent underline underline-offset-4">Leaderboard on the projector</Link>
          <button onClick={() => setShowReset(true)} className="text-bingo-text underline underline-offset-4">
            Reset for a rerun
          </button>
        </div>
      </section>

      {/* --------------------------------------------------------- criteria */}
      <section className="mt-8" aria-labelledby="criteria-h">
        <h2 id="criteria-h" className="font-display text-lg font-semibold">The 25 squares</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Edit any square&rsquo;s wording and it changes on every card already dealt — no redeploy.
          The count stays at 25; a 5×5 grid has no other option.
        </p>
        <ol className="mt-3 space-y-1">
          {(criteria ?? []).map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setEditing(c)}
                className="flex w-full items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left hover:border-line-strong"
              >
                <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs text-ink-faint">{c.position}</span>
                <span className="flex-1 text-sm leading-snug">{c.text}</span>
                {c.rule !== 'honor' && (
                  <span className="mt-0.5 shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                    checked
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------- moderation */}
      <section className="mt-8" aria-labelledby="mod-h">
        <h2 id="mod-h" className="font-display text-lg font-semibold">Moderate</h2>

        <h3 className="text-sm font-medium text-ink-muted">
          Live fills — watch for anyone farming one person
        </h3>
        <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
          {(fills ?? []).slice(0, 20).map((f) => (
            <li key={f.square_id} className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className="text-ink">{f.owner_name}</span>
                  <span className="text-ink-muted"> scanned </span>
                  <span className="text-ink">{f.filled_by_name}</span>
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {f.criterion_text} · {relativeTime(f.filled_at)}
                </p>
              </div>
              <button
                onClick={() => { if (confirm('Undo this fill? It frees the square and refunds their pair cap slot.')) moderate('undo_square', f.square_id); }}
                className="shrink-0 text-xs text-bingo-text underline underline-offset-2"
              >
                Undo
              </button>
            </li>
          ))}
          {(fills ?? []).length === 0 && <li className="text-sm text-ink-muted">Nobody has filled a square yet.</li>}
        </ul>

        <h3 className="mt-5 text-sm font-medium text-ink-muted">Recent posts</h3>
        <ul className="mt-2 space-y-1.5">
          {(posts ?? []).slice(0, 12).map((p) => (
            <li key={p.id} className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{p.criterion_text}</p>
                <p className="text-xs text-ink-muted">
                  {p.display_name} · {relativeTime(p.created_at)}
                </p>
              </div>
              <button
                onClick={() => moderate('hide_post', p.id, true)}
                className="shrink-0 text-xs text-bingo-text underline underline-offset-2"
              >
                Hide
              </button>
            </li>
          ))}
          {(posts ?? []).length === 0 && <li className="text-sm text-ink-muted">No posts yet.</li>}
        </ul>

        <h3 className="mt-5 text-sm font-medium text-ink-muted">Players ({players?.length ?? 0})</h3>
        <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
          {(players ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{p.display_name}</p>
                <p className="truncate text-xs text-ink-muted">{p.university}</p>
              </div>
              <button
                onClick={() => { if (confirm(`Remove ${p.display_name}? Their card stops working immediately.`)) moderate('remove_player', p.id); }}
                className="shrink-0 text-xs text-bingo-text underline underline-offset-2"
              >
                Remove
              </button>
            </li>
          ))}
          {(players ?? []).length === 0 && <li className="text-sm text-ink-muted">Nobody has joined yet.</li>}
        </ul>
      </section>

      {/* ------------------------------------------------------------ sheets */}
      <Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title={`Square ${editing?.position ?? ''}`}>
        {editing && (
          <CriterionEditor
            criterion={editing}
            onSaved={() => { setEditing(null); refetchCriteria(); toast.show('Updated on every card.'); }}
            onError={(m) => toast.fail(m)}
          />
        )}
      </Sheet>

      <Sheet open={showReset} onClose={() => setShowReset(false)} title="Reset for a rerun">
        <div className="space-y-4">
          <p className="rounded-lg border border-bingo/40 bg-bingo-dim px-4 py-3 text-sm text-bingo-text">
            This deletes every player, card, post and BINGO for this event and puts it back
            to waiting. The 25 squares stay. There is no undo.
          </p>
          <Field label={`Type "${event?.slug}" to confirm`}>
            {({ id }) => (
              <input
                id={id}
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                className={inputClass}
                autoComplete="off"
              />
            )}
          </Field>
          <Button
            variant="danger"
            size="lg"
            busy={busy === 'reset'}
            disabled={resetConfirm !== event?.slug}
            onClick={() => act('reset', resetConfirm)}
          >
            Wipe everything and start over
          </Button>
        </div>
      </Sheet>

      {toast.node}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value?: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <p className={cx('font-display text-2xl font-bold tabular', accent ? 'text-accent' : 'text-ink')}>
        {value ?? '—'}
      </p>
      <p className="text-xs text-ink-muted">{label}</p>
    </div>
  );
}

function CriterionEditor({
  criterion, onSaved, onError,
}: { criterion: Criterion; onSaved: () => void; onError: (m: string) => void }) {
  const [text, setText] = useState(criterion.text);
  const [rule, setRule] = useState(criterion.rule);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await send('/api/admin/criteria', { criterionId: criterion.id, text, rule });
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Wording" hint="Changes appear on every card already dealt.">
        {({ id }) => (
          <textarea
            id={id}
            value={text}
            rows={3}
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
            className={inputClass}
          />
        )}
      </Field>

      <Field label="Server check" hint="What the server verifies before letting a match through.">
        {({ id }) => (
          <select id={id} value={rule} onChange={(e) => setRule(e.target.value as Criterion['rule'])} className={inputClass}>
            <option value="honor">Honour system — the two people vouch for each other</option>
            <option value="diff_university">Must be a different university</option>
          </select>
        )}
      </Field>

      <Button size="lg" busy={busy} onClick={save}>Save</Button>
    </div>
  );
}
