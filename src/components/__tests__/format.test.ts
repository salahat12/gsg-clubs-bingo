import { describe, it, expect } from 'vitest';
import { formatElapsed, relativeTime } from '../ui';

describe('formatElapsed', () => {
  it.each([
    [0, '0:00.0'],
    [900, '0:00.9'],
    [1_000, '0:01.0'],
    [65_340, '1:05.3'],
    [599_900, '9:59.9'],
    [3_600_000, '1:00:00'],
    [3_725_000, '1:02:05'],
    [-50, '0:00.0'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  it('keeps every sub-hour value the same width, so columns do not jitter', () => {
    const widths = new Set([1_000, 61_000, 599_000].map((ms) => formatElapsed(ms).length));
    expect(widths.size).toBe(1);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-08-21T20:00:00Z').getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it.each([
    [0, 'just now'],
    [5_000, 'just now'],
    [42_000, '42s ago'],
    [90_000, '1m ago'],
    [3_600_000, '1h ago'],
    [90_000_000, '1d ago'],
  ])('renders %ims ago as %s', (ms, expected) => {
    expect(relativeTime(ago(ms), now)).toBe(expected);
  });

  it('never shows a negative time when a clock is slightly ahead', () => {
    expect(relativeTime(new Date(now + 5_000).toISOString(), now)).toBe('just now');
  });
});
