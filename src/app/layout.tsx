import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { LiveProvider } from '@/lib/live';
import { PlayerProvider } from '@/lib/player';
import { ConnectionBanner } from '@/components/ConnectionBanner';

/**
 * Space Grotesk has the slightly-off geometry of a good club poster and
 * keeps the app from reading as generic SaaS. Plex Sans carries the body
 * because criteria run to 74 characters and have to survive inside a 67px
 * grid tile — Plex holds its counters at small sizes better than Inter.
 * Plex Mono keeps leaderboard timers from jittering as digits change.
 * All three are self-hosted by next/font: no external request on load.
 */
const display = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

const sans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Networking Bingo',
  description: 'Scan the people, fill the squares, shout BINGO.',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Bingo' },
};

export const viewport: Viewport = {
  themeColor: '#0e1116',
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available. Locking it out breaks the app for anyone who
  // needs to magnify a criterion.
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-canvas text-ink">
        <LiveProvider>
          <PlayerProvider>
            <ConnectionBanner />
            {children}
          </PlayerProvider>
        </LiveProvider>
      </body>
    </html>
  );
}
