import Link from 'next/link';
import { RulesCard } from '@/components/RulesCard';

export const metadata = { title: 'How to play · Networking Bingo' };

export default function HowToPlayPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-4 py-8">
      <h1 className="font-display text-2xl font-bold">How to play</h1>
      <div className="mt-6">
        <RulesCard />
      </div>
      <Link
        href="/"
        className="mt-8 inline-block text-sm text-accent underline underline-offset-4"
      >
        Back to the game
      </Link>
    </main>
  );
}
