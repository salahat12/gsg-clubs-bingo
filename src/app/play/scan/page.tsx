'use client';

import { Suspense, useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePlayer } from '@/lib/player';
import { useLiveQuery } from '@/lib/live';
import { fetchBoard, fetchCard } from '@/lib/reads';
import { ApiError, send } from '@/lib/mutate';
import { newClientKey } from '@/lib/session';
import { Scanner } from '@/components/Scanner';
import { Button, Spinner, useToast } from '@/components/ui';
import type { CardSquare, ResolvedScan } from '@/lib/types';

type Step =
  | { kind: 'scan' }
  | { kind: 'manual' }
  | { kind: 'resolving' }
  | { kind: 'pick'; scanned: ResolvedScan; rawCode: string }
  | { kind: 'filling' }
  | { kind: 'done'; scanned: ResolvedScan; squareId: string; newLines: string[] };

type FillResult = {
  fill: { result: 'filled'; square_id: string; scanned_id: string; scanned_name: string; scanned_university: string; new_lines: string[] };
};
type ResolveResult = { scanned: ResolvedScan };

export default function ScanPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[60dvh] place-items-center"><Spinner className="size-6 text-accent" /></div>}>
      <Scan />
    </Suspense>
  );
}

function Scan() {
  const router = useRouter();
  const params = useSearchParams();
  // Square-first: arrived here from a specific empty square on the card.
  // Person-first: arrived from the bottom tab, no square chosen yet.
  const presetSquareId = params.get('square');

  const { player } = usePlayer();
  const toast = useToast();
  const [step, setStep] = useState<Step>({ kind: 'scan' });
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [openPostForSquare, setOpenPostForSquare] = useState<string | null>(null);

  const { data: mySquares } = useLiveQuery({
    tables: ['card_squares'],
    fetcher: () => (player ? fetchCard(player.id) : Promise.resolve([])),
    enabled: Boolean(player) && !presetSquareId,
    deps: [player?.id, presetSquareId],
  });

  const openSquares = (mySquares ?? []).filter((s) => s.status === 'empty').sort((a, b) => a.idx - b.idx);

  const fillSquare = useCallback(
    async (squareId: string, code: string) => {
      setStep({ kind: 'filling' });
      setError(null);
      try {
        const res = await send<FillResult>('/api/scan/fill', {
          code,
          squareId,
          clientKey: newClientKey(),
        });
        const f = res.fill;
        setStep({
          kind: 'done',
          scanned: { id: f.scanned_id, displayName: f.scanned_name, university: f.scanned_university },
          squareId,
          newLines: f.new_lines,
        });

        // Prompt to close a matching open post, if there is one — a post
        // has no mechanical link to the fill, so nothing does this for us.
        if (player) {
          try {
            const mine = await fetchBoard(player.eventId, { filter: 'mine', playerId: player.id, limit: 50 });
            const open = mine.find((p) => p.card_square_id === squareId && p.status === 'open');
            setOpenPostForSquare(open?.id ?? null);
          } catch {
            /* not critical — the post just stays open, closeable from the board */
          }
        }
      } catch (err) {
        setStep({ kind: 'scan' });
        setError(err instanceof ApiError ? err.message : 'That did not go through. Try again.');
      }
    },
    [player],
  );

  const resolveCode = useCallback(async (code: string) => {
    setStep({ kind: 'resolving' });
    setError(null);
    try {
      const res = await send<ResolveResult>('/api/scan/resolve', { code });
      setStep({ kind: 'pick', scanned: res.scanned, rawCode: code });
    } catch (err) {
      setStep({ kind: 'scan' });
      setError(err instanceof ApiError ? err.message : 'That code did not work. Try again.');
    }
  }, []);

  const onCode = (raw: string) => {
    if (presetSquareId) void fillSquare(presetSquareId, raw);
    else void resolveCode(raw);
  };

  const closePost = async (postId: string) => {
    try {
      await send(`/api/posts/${postId}/close`, {});
      toast.show('Closed.');
      setOpenPostForSquare(null);
    } catch (err) {
      toast.fail(err instanceof ApiError ? err.message : 'Could not close that post.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg px-3 pt-4">
      <header className="px-1">
        <h1 className="font-display text-xl font-bold leading-tight">
          {presetSquareId ? 'Scan to fill this square' : 'Scan someone'}
        </h1>
        <p className="text-sm text-ink-muted">
          {presetSquareId
            ? 'Point your camera at their code, or type it in.'
            : 'Scan first, then pick which square it fills.'}
        </p>
      </header>

      <div className="mt-4">
        {step.kind === 'scan' && (
          <>
            <Scanner onResult={onCode} onManualInstead={() => setStep({ kind: 'manual' })} />
            {error && <ErrorBanner message={error} />}
          </>
        )}

        {step.kind === 'manual' && (
          <ManualEntry
            value={manualCode}
            onChange={setManualCode}
            onSubmit={() => manualCode.trim() && onCode(manualCode.trim())}
            onBack={() => setStep({ kind: 'scan' })}
            error={error}
          />
        )}

        {(step.kind === 'resolving' || step.kind === 'filling') && (
          <div className="grid min-h-[40dvh] place-items-center">
            <Spinner className="size-6 text-accent" />
          </div>
        )}

        {step.kind === 'pick' && (
          <SquarePicker
            scanned={step.scanned}
            squares={openSquares}
            onPick={(squareId) => fillSquare(squareId, step.rawCode)}
            onCancel={() => setStep({ kind: 'scan' })}
          />
        )}

        {step.kind === 'done' && (
          <div className="space-y-4 text-center">
            <div className="rounded-xl border border-confirmed/50 bg-confirmed-dim px-5 py-6">
              <p className="font-display text-2xl font-bold text-ink">Filled</p>
              <p className="mt-1 text-ink-muted">
                Matched with <span className="text-ink">{step.scanned.displayName}</span>
              </p>
              {step.newLines.length > 0 && (
                <p className="mt-2 text-sm font-medium text-bingo-text">BINGO! You completed a line.</p>
              )}
            </div>

            {openPostForSquare && (
              <div className="rounded-lg border border-line-strong bg-surface-2 px-4 py-3 text-left">
                <p className="text-sm text-ink-muted">
                  You had an open post for that square. Close it so people stop replying to a match already made?
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="md" onClick={() => closePost(openPostForSquare)}>Close it</Button>
                  <Button variant="ghost" size="md" onClick={() => setOpenPostForSquare(null)}>Leave it open</Button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button size="lg" onClick={() => router.push('/play/card')}>Back to my card</Button>
              <Button variant="secondary" size="lg" onClick={() => setStep({ kind: 'scan' })}>Scan another</Button>
            </div>
          </div>
        )}
      </div>

      {toast.node}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-3 rounded-lg border border-bingo/40 bg-bingo-dim px-3 py-2.5 text-sm text-bingo-text">
      {message}
    </p>
  );
}

function ManualEntry({
  value, onChange, onSubmit, onBack, error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  error: string | null;
}) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className="space-y-3"
    >
      <label htmlFor="manual-code" className="block text-sm font-medium">
        Their 6-character code
      </label>
      <input
        id="manual-code"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        maxLength={8}
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        placeholder="4F7K2H"
        className="w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-3 text-center font-mono text-2xl tracking-[0.3em] outline-none placeholder:text-ink-faint focus:border-accent"
      />
      {error && <ErrorBanner message={error} />}
      <Button type="submit" size="lg" disabled={!value.trim()}>Continue</Button>
      <button
        type="button"
        onClick={onBack}
        className="w-full text-center text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
      >
        Use the camera instead
      </button>
    </form>
  );
}

function SquarePicker({
  scanned, squares, onPick, onCancel,
}: {
  scanned: ResolvedScan;
  squares: CardSquare[];
  onPick: (squareId: string) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-accent/50 bg-accent-dim/25 px-4 py-3">
        <p className="text-sm text-ink-muted">You scanned</p>
        <p className="mt-0.5 font-display text-lg font-semibold">{scanned.displayName}</p>
        <p className="text-sm text-ink-muted">{scanned.university}</p>
      </div>

      <p className="text-sm text-ink-muted">Which of your empty squares does this fill?</p>

      {squares.length === 0 ? (
        <p className="text-sm text-ink-muted">Your card has no empty squares left.</p>
      ) : (
        <ul className="max-h-[45dvh] space-y-1.5 overflow-y-auto pr-1">
          {squares.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setSelected(s.id)}
                aria-pressed={selected === s.id}
                className="w-full rounded-lg border px-3 py-2.5 text-left text-[15px] leading-snug data-[sel=true]:border-accent data-[sel=true]:bg-accent-dim/30 border-line bg-surface-2 text-ink-muted hover:border-line-strong"
                data-sel={selected === s.id}
              >
                <span className={selected === s.id ? 'text-ink' : undefined}>{s.criterion_text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={onCancel}>Cancel</Button>
        <Button size="lg" disabled={!selected} onClick={() => selected && onPick(selected)}>
          Fill this square
        </Button>
      </div>
    </div>
  );
}
