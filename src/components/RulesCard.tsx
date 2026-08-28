export function RulesCard() {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed">
      <p className="rounded-lg border-l-2 border-accent bg-surface-2 px-4 py-3 text-ink">
        Scan someone to fill a square. Fill a full row, column, or diagonal and shout BINGO.
      </p>

      <ol className="space-y-3 text-ink-muted">
        <li className="flex gap-3">
          <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs text-accent">1</span>
          <span>Tap any square to see what it asks for. You get all 25 in a shuffled order, so your neighbour&rsquo;s card is not yours.</span>
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs text-accent">2</span>
          <span>Find someone who matches it, then tap <strong className="text-ink">Scan to fill</strong>. Point your camera at their QR code (their &ldquo;My code&rdquo; screen), or type their 6-character code.</span>
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs text-accent">3</span>
          <span>That&rsquo;s it — the square fills the moment you scan them. Nobody has to approve anything.</span>
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs text-accent">4</span>
          <span>Can&rsquo;t think of anyone for a square? <strong className="text-ink">Ask the board</strong> instead. Once someone replies, go meet them and scan.</span>
        </li>
      </ol>

      <div className="rounded-lg border border-line-strong bg-surface-2 px-4 py-3 text-sm text-ink-muted">
        <p className="font-medium text-ink">Worth knowing</p>
        <ul className="mt-2 space-y-1.5 list-disc pl-4">
          <li>You can only fill <strong className="text-ink">two squares with the same person</strong>. Twenty-five squares means at least thirteen different people.</li>
          <li>Your code rotates every 60 seconds, so a screenshot someone sends you later won&rsquo;t work — you have to actually be there.</li>
          <li>The clock runs from the moment the organiser starts the game, not from when you joined.</li>
          <li>Check <strong className="text-ink">People I met</strong> any time to see everyone you&rsquo;ve matched with so far — that&rsquo;s what you walk away with.</li>
        </ul>
      </div>
    </div>
  );
}
