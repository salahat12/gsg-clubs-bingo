'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LobbyCluster, LobbyPlayer } from '@/lib/types';
import { cx } from './ui';

/**
 * The lobby constellation.
 *
 * Every person who joins is a point of light; every university is its own
 * cluster; the room fills with stars as people arrive. It is built to be
 * projected on a screen by the door, so it has to stay readable at four
 * metres and stay smooth at 300 nodes on a laptop driving a projector.
 *
 * Three things keep it cheap:
 *   - positions are derived from a hash of the player id, so a star never
 *     moves once placed and adding an arrival re-renders nothing else;
 *   - stars are laid out by phyllotaxis, which distributes evenly without
 *     collision detection;
 *   - only a third of the stars twinkle, and only opacity animates, so
 *     the whole thing composites on the GPU.
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Stable per-player jitter, so the scatter looks organic but never shifts. */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

type Props = {
  clusters: LobbyCluster[];
  players: LobbyPlayer[];
  /** Bigger type and no interaction, for the projector. */
  display?: boolean;
};

export function Constellation({ clusters, players, display = false }: Props) {
  const reduced = usePrefersReducedMotion();

  const byUniversity = useMemo(() => {
    const map = new Map<string, LobbyPlayer[]>();
    for (const p of players) {
      const list = map.get(p.university_value);
      if (list) list.push(p);
      else map.set(p.university_value, [p]);
    }
    return map;
  }, [players]);

  const ordered = useMemo(
    () => [...clusters].sort((a, b) => b.player_count - a.player_count || a.university.localeCompare(b.university)),
    [clusters],
  );

  // Which stars are new since the last render, so only they animate in.
  // Adjusted during render (React's documented pattern for "derive state
  // from a prop change") rather than in an effect, because refs cannot be
  // read or written during render — there is no ref-based equivalent of
  // this that stays compliant.
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  const newlyArrived = players.filter((p) => !seen.has(p.id));
  if (newlyArrived.length > 0) {
    const nextSeen = new Set(seen);
    newlyArrived.forEach((p) => nextSeen.add(p.id));
    setSeen(nextSeen);
    setFresh(new Set(newlyArrived.map((p) => p.id)));
  }

  // The only part that genuinely belongs in an effect: clearing the
  // "fresh" flag after the arrival animation has had time to play.
  useEffect(() => {
    if (fresh.size === 0) return;
    const t = setTimeout(() => setFresh(new Set()), 900);
    return () => clearTimeout(t);
  }, [fresh]);

  if (!players.length) {
    return (
      <div className="grid place-items-center py-16 text-center">
        <p className={cx('font-display font-semibold', display ? 'text-3xl' : 'text-lg')}>
          Nobody here yet
        </p>
        <p className={cx('mt-2 text-ink-muted', display ? 'text-xl' : 'text-sm')}>
          The first person to scan the QR code shows up right here.
        </p>
      </div>
    );
  }

  // The static fallback is a real roster, not a degraded constellation:
  // grouped, counted, and readable.
  if (reduced) {
    return (
      <div className="space-y-5">
        {ordered.map((c) => (
          <section key={c.university_value}>
            <h3 className={cx('font-display font-semibold flex items-baseline gap-2', display ? 'text-2xl' : 'text-base')}>
              {c.university}
              <span className="font-mono text-accent tabular text-[0.8em]">{c.player_count}</span>
            </h3>
            <ul className={cx('mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-ink-muted', display ? 'text-lg' : 'text-sm')}>
              {(byUniversity.get(c.university_value) ?? []).map((p) => (
                <li key={p.id} className="after:content-['·'] after:ml-2 after:text-ink-faint last:after:content-['']">
                  {p.display_name}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-center gap-x-6 gap-y-8">
      {ordered.map((cluster) => (
        <Cluster
          key={cluster.university_value}
          cluster={cluster}
          members={byUniversity.get(cluster.university_value) ?? []}
          fresh={fresh}
          display={display}
        />
      ))}
    </div>
  );
}

function Cluster({
  cluster, members, fresh, display,
}: {
  cluster: LobbyCluster;
  members: LobbyPlayer[];
  fresh: Set<string>;
  display: boolean;
}) {
  const n = Math.max(members.length, 1);
  // Area grows with headcount, so a 60-person university reads as bigger
  // than a 4-person one without swamping the screen. Small clusters stay
  // compact so four people do not float lost in a large empty halo.
  const size = Math.min(display ? 320 : 210, (display ? 72 : 60) + Math.sqrt(n) * (display ? 27 : 20));
  const radius = size / 2;
  // Projected, a star has to read from across a room, so the floor is
  // generous and small clusters get proportionally larger points.
  const dot = Math.max(display ? 5 : 3, Math.min(display ? 11 : 7, 40 / Math.sqrt(n) + 3));

  const stars = useMemo(
    () =>
      members.map((p, i) => {
        const jitter = hash(p.id);
        // phyllotaxis: even coverage of the disc with no collision checks
        const r = radius * 0.82 * Math.sqrt((i + 0.5) / n) + (jitter - 0.5) * dot * 1.4;
        const theta = i * GOLDEN_ANGLE + jitter * 0.55;
        return {
          player: p,
          x: radius + Math.cos(theta) * r,
          y: radius + Math.sin(theta) * r,
          twinkle: i % 3 === 0,
          delay: `${(jitter * 4).toFixed(2)}s`,
        };
      }),
    [members, n, radius, dot],
  );

  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${cluster.university}: ${cluster.player_count} ${cluster.player_count === 1 ? 'person' : 'people'}`}
        className="overflow-visible"
      >
        <defs>
          <radialGradient id={`halo-${cluster.university_value.replace(/\W/g, '')}`}>
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.13" />
            <stop offset="70%" stopColor="var(--color-accent)" stopOpacity="0.04" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle
          cx={radius} cy={radius} r={radius}
          fill={`url(#halo-${cluster.university_value.replace(/\W/g, '')})`}
        />

        <g style={{ filter: 'drop-shadow(0 0 3px color-mix(in oklab, var(--color-accent) 60%, transparent))' }}>
        {stars.map((s) => (
          <circle
            key={s.player.id}
            cx={s.x}
            cy={s.y}
            r={dot}
            fill="var(--color-accent)"
            className={cx(
              fresh.has(s.player.id) && 'animate-star-in',
              s.twinkle && 'animate-twinkle',
            )}
            style={{
              animationDelay: s.twinkle ? s.delay : undefined,
              transformOrigin: `${s.x}px ${s.y}px`,
            }}
          >
            <title>{s.player.display_name}</title>
          </circle>
        ))}
        </g>
      </svg>

      <p className={cx('mt-2 text-center font-display font-semibold leading-tight max-w-[16ch]', display ? 'text-xl' : 'text-sm')}>
        {cluster.university}
      </p>
      <p className={cx('font-mono tabular text-accent', display ? 'text-lg' : 'text-xs')}>
        {cluster.player_count}
      </p>
    </div>
  );
}
