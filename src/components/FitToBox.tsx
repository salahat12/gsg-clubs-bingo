'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Scales its children down until they fit the available box.
 *
 * The projector view has no scrollbar anyone will ever use — a screen by
 * the door is glanced at, not operated. So as the room fills and the
 * constellation grows past the bottom of the screen, the whole thing
 * shrinks to fit instead of hiding the last university.
 *
 * scrollWidth/scrollHeight are unaffected by CSS transforms, so the
 * natural size can be measured while a scale is already applied — no
 * reset, and no measure/apply feedback loop.
 */
export function FitToBox({ children, deps = [] }: { children: React.ReactNode; deps?: unknown[] }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [{ scale, offsetY }, setFit] = useState({ scale: 1, offsetY: 0 });

  const fit = useCallback(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;

    const w = content.scrollWidth;
    const h = content.scrollHeight;
    if (!w || !h) return;

    const next = Math.min(1, box.clientWidth / w, box.clientHeight / h);
    const s = Number.isFinite(next) && next > 0 ? next : 1;

    // Centre it ourselves. CSS Grid aligns an item that is TALLER than
    // its track to the start rather than the centre, so scaling about the
    // element's own centre pushes it down and off the bottom of the
    // screen. Anchoring to the top and translating by the leftover space
    // is exact at any scale.
    setFit({ scale: s, offsetY: Math.max(0, (box.clientHeight - h * s) / 2) });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { fit(); }, [fit, ...deps]);

  useEffect(() => {
    if (!outer.current || !inner.current) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };

    // Both boxes are observed. That is safe from a feedback loop because
    // ResizeObserver reports the layout box, which a CSS transform does
    // not affect — scaling the content cannot retrigger the observer.
    const ro = new ResizeObserver(schedule);
    ro.observe(outer.current);
    ro.observe(inner.current);

    // Webfonts land after first paint and change the content height, so
    // fit again once they have.
    void document.fonts?.ready.then(schedule).catch(() => {});
    const settle = setTimeout(schedule, 300);

    return () => { ro.disconnect(); cancelAnimationFrame(frame); clearTimeout(settle); };
  }, [fit]);

  return (
    <div ref={outer} className="grid h-full w-full items-start justify-items-center overflow-hidden">
      <div
        ref={inner}
        data-fit-scale={scale.toFixed(3)}
        style={{
          transform: `translateY(${offsetY}px) scale(${scale})`,
          transformOrigin: 'center top',
        }}
      >
        {children}
      </div>
    </div>
  );
}
