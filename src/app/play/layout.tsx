'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { usePlayer } from '@/lib/player';
import { useLive, useLiveQuery } from '@/lib/live';
import { fetchEvent } from '@/lib/reads';
import { ConfirmPrompt } from '@/components/ConfirmPrompt';
import { Spinner, cx } from '@/components/ui';

const TABS = [
  {
    href: '/play/card',
    label: 'Card',
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
      </>
    ),
  },
  {
    href: '/play/board',
    label: 'Board',
    icon: (
      <>
        <path d="M4 5.5h16M4 12h16M4 18.5h11" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: '/play/leaderboard',
    label: 'Ranking',
    icon: (
      <>
        <path d="M6 20V11M12 20V4M18 20v-6" strokeLinecap="round" />
      </>
    ),
  },
];

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { player, loading } = usePlayer();
  const { serverNow } = useLive();

  const { data: event } = useLiveQuery({ tables: ['events'], fetcher: fetchEvent });

  useEffect(() => {
    if (!loading && !player) router.replace('/');
  }, [loading, player, router]);

  // The start gate is enforced in the database, but a player sitting on
  // /play/card before the start should still be sent back to the lobby
  // rather than shown a card they cannot use.
  useEffect(() => {
    if (!event) return;
    const startsAt = event.started_at ? new Date(event.started_at).getTime() : null;
    const live = event.status !== 'waiting' && startsAt !== null && serverNow() >= startsAt;
    if (!live && event.status !== 'ended') router.replace('/lobby');
  }, [event, serverNow, router]);

  if (loading || !player) {
    return (
      <div className="min-h-dvh grid place-items-center">
        <Spinner className="size-6 text-accent" />
        <span className="sr-only">Loading your card</span>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col">
      {event?.status === 'paused' && (
        <div role="status" className="bg-accent-dim/50 border-b border-accent/40 px-4 py-2 text-center text-sm text-accent">
          The organiser paused the game. Squares are locked until it resumes.
        </div>
      )}
      {event?.status === 'ended' && (
        <div role="status" className="bg-surface-2 border-b border-line-strong px-4 py-2 text-center text-sm text-ink-muted">
          The game has ended. The leaderboard is final.
        </div>
      )}

      <main className="flex-1 pb-20">{children}</main>

      <ConfirmPrompt />

      <nav
        aria-label="Main"
        className="fixed bottom-0 inset-x-0 z-40 border-t border-line bg-surface/95 backdrop-blur safe-bottom"
      >
        <ul className="mx-auto flex max-w-lg">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium',
                    active ? 'text-accent' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="size-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    aria-hidden="true"
                  >
                    {tab.icon}
                  </svg>
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
