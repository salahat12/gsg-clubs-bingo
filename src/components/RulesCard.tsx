export function RulesCard() {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed">
      <p className="rounded-lg border-l-2 border-accent bg-surface-2 px-4 py-3 text-ink">
        Mark a square when you find someone who matches it. Fill a full row, column,
        or diagonal and shout BINGO.
      </p>

      <ol className="space-y-3 text-ink-muted">
        <li className="flex gap-3">
          <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs text-accent">1</span>
          <span>Tap any square to see what it asks for. You get all 25 in a shuffled order, so your neighbour&rsquo;s card is not yours.</span>
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs text-accent">2</span>
          <span><strong className="text-ink">Ask for help</strong> to put it on the board, or <strong className="text-ink">offer help</strong> if the square describes you and you are happy to be someone&rsquo;s match.</span>
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs text-accent">3</span>
          <span>Go and actually meet them. Use the replies to say where you are.</span>
        </li>
        <li className="flex gap-3">
          <span aria-hidden className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs text-accent">4</span>
          <span>Mark them as your match. They get a prompt and tap Confirm. Only then does the square fill.</span>
        </li>
      </ol>

      <div className="rounded-lg border border-line-strong bg-surface-2 px-4 py-3 text-sm text-ink-muted">
        <p className="font-medium text-ink">Two things worth knowing</p>
        <ul className="mt-2 space-y-1.5 list-disc pl-4">
          <li>You can only fill <strong className="text-ink">two squares with the same person</strong>. Twenty-five squares means at least thirteen different people.</li>
          <li>The clock runs from the moment the organiser starts the game, not from when you joined.</li>
        </ul>
      </div>
    </div>
  );
}
