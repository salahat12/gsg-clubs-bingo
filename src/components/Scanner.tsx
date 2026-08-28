'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Spinner } from './ui';

/**
 * The camera scanner. This is the whole game now, so it fails soft:
 * permission denied, no camera, or bad light all drop straight into the
 * manual code entry rather than a dead end. Assume ~20% of phones hit
 * some camera problem — the fallback link is always visible, never
 * something you have to discover after an error.
 */
export function Scanner({
  onResult, onManualInstead,
}: {
  onResult: (raw: string) => void;
  onManualInstead: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  // Capability is an environment fact, not something to discover via an
  // effect: read once at init, same as isConfigured()/navigator.onLine
  // elsewhere in this app. `window`, not `navigator`, is the browser-only
  // guard — some dev SSR runtimes polyfill a bare `navigator` global,
  // which would make the server and the real client disagree here and
  // fail hydration.
  const supported =
    typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'denied' | 'unsupported'>(
    () => (supported ? 'starting' : 'unsupported'),
  );
  const resultSent = useRef(false);

  useEffect(() => {
    if (!supported) return;
    resultSent.current = false;
    let cancelled = false;

    void (async () => {
      try {
        // Dynamic import: the zxing bundle is sizeable and camera scanning
        // is only ever needed on this one screen.
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        const reader = new BrowserQRCodeReader();
        if (cancelled || !videoRef.current) return;

        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          videoRef.current,
          (result) => {
            if (result && !resultSent.current) {
              resultSent.current = true;
              onResult(result.getText());
            }
          },
        );
        if (cancelled) { controls.stop(); return; }
        controlsRef.current = controls;
        setStatus('scanning');
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'denied' || status === 'unsupported') {
    return (
      <div className="rounded-xl border border-line-strong bg-surface-2 px-5 py-8 text-center">
        <p className="font-display font-semibold">
          {status === 'denied' ? "Can't use the camera" : 'Camera not available here'}
        </p>
        <p className="mt-1.5 text-sm text-ink-muted">
          {status === 'denied'
            ? 'Check your browser\'s camera permission for this site, or just type the code instead.'
            : 'Type the 6-character code shown on their screen instead.'}
        </p>
        <Button size="lg" className="mt-4" onClick={onManualInstead}>Enter code instead</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        {status === 'starting' && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <Spinner className="size-6 text-white" />
          </div>
        )}
        {status === 'scanning' && (
          <div aria-hidden className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-accent/80" />
        )}
      </div>
      <p className="text-center text-sm text-ink-muted">Point the camera at their QR code.</p>
      <button
        type="button"
        onClick={onManualInstead}
        className="w-full text-center text-sm text-accent underline underline-offset-4"
      >
        Enter code instead
      </button>
    </div>
  );
}
