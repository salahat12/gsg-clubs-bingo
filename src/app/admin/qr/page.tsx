'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { SITE_URL } from '@/lib/config';
import { Button, Spinner, useToast } from '@/components/ui';

/**
 * The QR poster.
 *
 * Generated in the browser with the `qrcode` package rather than an
 * external image service: the poster has to render if the venue wifi is
 * down, and nobody's event URL should be logged by a third party.
 *
 * Error correction is set to H (30% recoverable) because this gets
 * printed, taped to a wall, and photographed at an angle in bad light.
 */
const PNG_SIZE = 2048; // ~173 dpi at 30cm — comfortably past print quality

export default function QrPage() {
  const toast = useToast();
  const [url, setUrl] = useState(SITE_URL);
  const [svg, setSvg] = useState<string | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Prefer the origin actually being served, so a QR generated from a
  // preview deployment does not point at localhost. This has to stay an
  // effect rather than a lazy initializer: the server-rendered HTML uses
  // SITE_URL, and reading window.location.origin during the initial
  // client render (instead of after mount) would mismatch that markup.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.origin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above: this must run post-mount to avoid a hydration mismatch
      setUrl((prev) => (prev === 'http://localhost:3000' ? window.location.origin : prev));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const opts = { errorCorrectionLevel: 'H' as const, margin: 2 };
      const [s, p, prev] = await Promise.all([
        QRCode.toString(url, { ...opts, type: 'svg', color: { dark: '#000000', light: '#ffffff' } }),
        QRCode.toDataURL(url, { ...opts, width: PNG_SIZE, color: { dark: '#000000', light: '#ffffff' } }),
        QRCode.toDataURL(url, { ...opts, width: 640, color: { dark: '#0e1116', light: '#ffffff' } }),
      ]);
      if (cancelled) return;
      setSvg(s);
      setPng(p);
      setPreview(prev);
    })();
    return () => { cancelled = true; };
  }, [url]);

  const svgHref = useMemo(
    () => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null),
    [svg],
  );

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'GSG Clubs Networking Bingo', url });
      else {
        await navigator.clipboard.writeText(url);
        toast.show('Link copied.');
      }
    } catch {
      /* the user dismissed the share sheet */
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="print-hide">
        <Link href="/admin" className="text-sm text-accent underline underline-offset-4">
          ← Back to controls
        </Link>
        <h1 className="mt-3 font-display text-2xl font-bold">QR poster</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Print this and tape it by the door. Anyone who scans it lands on the join screen.
        </p>

        <label htmlFor="qr-url" className="mt-6 block text-sm font-medium">
          Where it points
        </label>
        <input
          id="qr-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 font-mono text-sm outline-none focus:border-accent"
        />
        <p className="mt-1.5 text-xs text-ink-muted">
          Set <code className="font-mono text-ink">NEXT_PUBLIC_SITE_URL</code> in production so this
          is right by default.
        </p>
      </div>

      {/* ------------------------------------------------- the printed sheet */}
      <div className="print-sheet mt-8 rounded-2xl border border-line-strong bg-white p-8 text-center text-black">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-black/60">GSG Clubs</p>
        <h2 className="mt-2 font-display text-4xl font-bold leading-tight text-black">
          Networking Bingo
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-base text-black/70">
          Scan to get your card. Then go and find twenty-five people.
        </p>

        <div className="mx-auto mt-6 grid aspect-square w-full max-w-[380px] place-items-center">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={`QR code linking to ${url}`} className="h-full w-full" />
          ) : (
            <Spinner className="size-6 text-black" />
          )}
        </div>

        <p className="mt-4 break-all font-mono text-2xl font-medium text-black">
          {url.replace(/^https?:\/\//, '')}
        </p>
        <p className="mt-2 text-sm text-black/60">
          No app, no sign-up. Works on any phone.
        </p>
      </div>

      {/* -------------------------------------------------------- downloads */}
      <div className="print-hide mt-6 grid gap-2 sm:grid-cols-3">
        <a href={png ?? '#'} download="gsg-bingo-qr.png" aria-disabled={!png}>
          <Button variant="secondary" size="lg" disabled={!png}>Download PNG</Button>
        </a>
        <a href={svgHref ?? '#'} download="gsg-bingo-qr.svg" aria-disabled={!svgHref}>
          <Button variant="secondary" size="lg" disabled={!svgHref}>Download SVG</Button>
        </a>
        <Button size="lg" onClick={() => window.print()}>Print A4 poster</Button>
      </div>

      <div className="print-hide mt-3">
        <Button variant="ghost" onClick={share}>Share the link instead</Button>
      </div>

      <p className="print-hide mt-4 text-xs text-ink-muted">
        PNG is {PNG_SIZE}×{PNG_SIZE} at error-correction level H, which stays scannable if the
        poster gets scuffed or partly covered. SVG scales to any size for a printer.
      </p>

      {toast.node}
    </main>
  );
}
