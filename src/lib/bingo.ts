import { GRID, SQUARE_COUNT } from './config';

/**
 * The 12 winning lines, as grid indices. This mirrors complete_lines() in
 * db/migrations/0002_rules.sql exactly, and db/tests/bingo-parity.test.ts
 * asserts the two agree on every one of the 2^25 patterns it samples.
 *
 * The server is authoritative. This copy exists so the card can render a
 * "one square away" hint and animate a line the instant it fills, without
 * waiting for a round trip.
 */
export type Line = { key: string; idxs: number[] };

export const LINES: Line[] = [
  ...Array.from({ length: GRID }, (_, r) => ({
    key: `row:${r}`,
    idxs: Array.from({ length: GRID }, (_, c) => r * GRID + c),
  })),
  ...Array.from({ length: GRID }, (_, c) => ({
    key: `col:${c}`,
    idxs: Array.from({ length: GRID }, (_, r) => r * GRID + c),
  })),
  { key: 'diag:0', idxs: Array.from({ length: GRID }, (_, i) => i * GRID + i) },
  { key: 'diag:1', idxs: Array.from({ length: GRID }, (_, i) => i * GRID + (GRID - 1 - i)) },
];

export function completeLines(filled: boolean[]): string[] {
  if (filled.length !== SQUARE_COUNT) return [];
  return LINES.filter((l) => l.idxs.every((i) => filled[i])).map((l) => l.key);
}

/** Every index that belongs to at least one complete line. */
export function cellsInCompleteLines(filled: boolean[]): Set<number> {
  const out = new Set<number>();
  for (const line of LINES) {
    if (line.idxs.every((i) => filled[i])) line.idxs.forEach((i) => out.add(i));
  }
  return out;
}

/**
 * How many squares stand between the player and their next line, and
 * which ones. Drives the "one away" nudge on the card.
 */
export function closestLine(filled: boolean[]): { line: Line; missing: number[] } | null {
  let best: { line: Line; missing: number[] } | null = null;
  for (const line of LINES) {
    const missing = line.idxs.filter((i) => !filled[i]);
    if (missing.length === 0) continue;
    if (!best || missing.length < best.missing.length) best = { line, missing };
  }
  return best;
}
