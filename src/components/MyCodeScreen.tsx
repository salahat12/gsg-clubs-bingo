'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useLive } from '@/lib/live';
import { getToken } from '@/lib/session';
import { cx, Spinner } from './ui';
import type { ScanCredential } from '@/lib/types';

const ROTATE_SECONDS = 60;
const GREY_LAST = 10;

/**
 * "My code" — a large QR plus a 6-character fallback, both proof that the
 * scanning player is physically in front of whoever is looking at this
 * screen. It rotates every 60s; the client tracks rotation off the shared
 * server clock (useLive's serverNow, already corrected for skew) so it
 * refetches a fresh code the instant the old one would stop working,
 * rather than guessing from a local timer.
 */
export function MyCodeScreen() {
  const { serverNow } = useLive();
  const [cred, setCred] = useState<ScanCredential | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const fetchedBucket = useRef<number | null>(null);

  // Tick every second to drive the countdown and to notice a rotation.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const nowSec = Math.floor(serverNow() / 1000);
  const currentBucket = Math.floor(nowSec / ROTATE_SECONDS);
  const secondsRemaining = ROTATE_SECONDS - (nowSec % ROTATE_SECONDS);

  // Fetch on mount, then again the instant the bucket rolls over — defined
  // inline (not via an outer useCallback) so the effect body is the whole
  // story: one async round trip, one state update, nothing synchronous.
  useEffect(() => {
    if (fetchedBucket.current === currentBucket) return;
    let cancelled = false;
    void (async () => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch('/api/scan/token', { headers: { 'x-player-token': token } });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { ok: true } & ScanCredential;
        fetchedBucket.current = data.bucket;
        setCred(data);
      } catch {
        // keep showing the last code — a screen that goes blank on a
        // wifi blink is worse than one that shows a code a few seconds
        // stale
      }
    })();
    return () => { cancelled = true; };
  }, [currentBucket]);

  // Screen Wake Lock: the phone must not sleep mid-handoff. Feature-
  // detected — plenty of browsers still lack it, and that is fine, the
  // code just has to be tapped awake again.
  useEffect(() => {
    let released = false;
    const request = async () => {
      if (!('wakeLock' in navigator)) return;
      try {
        wakeLockRef.current = await (navigator as Navigator & {
          wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinel> };
        }).wakeLock.request('screen');
      } catch {
        /* denied or unsupported — the screen just times out normally */
      }
    };
    void request();
    const onVisible = () => { if (document.visibilityState === 'visible' && !released) void request(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!cred) return;
    let cancelled = false;
    QRCode.toDataURL(cred.token, {
      width: 480,
      margin: 1,
      color: { dark: '#0e1116', light: '#ffffff' },
    })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cred]);

  const dying = secondsRemaining <= GREY_LAST;

  if (!cred) {
    return (
      <div className="grid min-h-[50dvh] place-items-center">
        <Spinner className="size-6 text-accent" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center px-4 py-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">My code</p>
      <p className="mt-1 text-sm text-ink-muted">Have them scan this, or type the code below.</p>

      <div
        className={cx(
          'mt-6 rounded-2xl border-4 p-3 transition-opacity duration-500',
          dying ? 'border-line opacity-40' : 'border-accent opacity-100',
        )}
      >
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URI, not a remote image
          <img src={qrDataUrl} alt="Your scan code" width={240} height={240} className="block size-60" />
        ) : (
          <div className="grid size-60 place-items-center"><Spinner className="size-6 text-accent" /></div>
        )}
      </div>

      <p
        className={cx(
          'mt-5 font-mono text-4xl font-bold tracking-[0.25em] transition-opacity duration-500',
          dying ? 'text-ink-faint opacity-50' : 'text-ink opacity-100',
        )}
        aria-live="off"
      >
        {cred.code}
      </p>

      <p className="mt-3 font-mono text-xs text-ink-muted" aria-live="polite">
        {dying ? `Refreshing in ${secondsRemaining}s…` : `New code in ${secondsRemaining}s`}
      </p>
    </div>
  );
}
