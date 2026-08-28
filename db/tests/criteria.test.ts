import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, joinPlayer } from './harness';

/**
 * The 25 criteria, transcribed from the brief. The brief says "exact, do
 * not rewrite", so this test is the guard on that: if anyone tidies a
 * word in the seed, this fails.
 */
const CRITERIA: Array<[number, string]> = [
  [1,  'Has completed the current phase of their university at DataCamp'],
  [2,  'Has participated in a DataCamp competition or hackathon'],
  [3,  'Passed the Data Literacy certificate'],
  [4,  'Is from a different university than you'],
  [5,  'Has built AI projects outside DataCamp'],
  [6,  'Joined DataCamp without knowing what they were getting into'],
  [7,  'Was in the previous scholarship (2024-2025)'],
  [8,  'Started before you and can say what they would do differently'],
  [9,  'Has restarted the same course more than once'],
  [10, 'Went a full month without opening DataCamp and came back'],
  [11, 'Has failed an exam on DataCamp'],
  [12, 'Could not complete a course and skipped it'],
  [13, 'Almost dropped out and did not'],
  [14, 'Has used something learned from DataCamp outside the platform'],
  [15, 'Has the longest streak in the room'],
  [16, 'Cheated a little on an exercise and felt bad about it'],
  [17, 'Still does not fully understand something they passed'],
  [18, 'Finished a track and immediately forgot most of it'],
  [19, 'Has an error message they will never forget'],
  [20, 'Does their best work after midnight'],
  [21, 'Has never asked anyone in the program for help'],
  [22, 'Explained something wrong to someone confidently'],
  [23, 'Would take the whole program again differently'],
  [24, 'Has a resource outside DataCamp worth stealing'],
  [25, 'Has a study routine worth copying'],
];

describe('the criteria set', () => {
  let db: PGlite;
  beforeAll(async () => { db = await freshDb(); });

  it('seeds exactly 25', async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int n from criteria where active`);
    expect(r.rows[0].n).toBe(25);
  });

  it.each(CRITERIA)('criterion %i is verbatim', async (position, text) => {
    const r = await db.query<{ text: string }>(
      `select text from criteria where position = $1`, [position]);
    expect(r.rows[0].text).toBe(text);
  });

  it('marks only criterion 4 as machine-checkable', async () => {
    const r = await db.query<{ position: number; rule: string }>(
      `select position, rule from criteria where rule <> 'honor' order by position`);
    expect(r.rows).toEqual([
      { position: 4, rule: 'diff_university' },
    ]);
  });

  it('re-running the seed updates in place rather than duplicating', async () => {
    const { readFileSync } = await import('node:fs');
    await db.exec(readFileSync('db/seed.sql', 'utf8'));
    const r = await db.query<{ n: number }>(`select count(*)::int n from criteria`);
    expect(r.rows[0].n).toBe(25);
  });

  it('deals every criterion exactly once per card', async () => {
    const p = await joinPlayer(db, 'Bara', { university: 'aqu' });
    const r = await db.query<{ n: number; distinct_criteria: number; distinct_idx: number }>(
      `select count(*)::int n,
              count(distinct criterion_id)::int distinct_criteria,
              count(distinct idx)::int distinct_idx
         from card_squares where card_id = $1`, [p.card_id]);
    expect(r.rows[0]).toEqual({ n: 25, distinct_criteria: 25, distinct_idx: 25 });
  });

  it('gives different players different layouts', async () => {
    const layouts = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const p = await joinPlayer(db, `P${i}`, { university: 'aqu' });
      const r = await db.query<{ position: number }>(
        `select c.position from card_squares cs join criteria c on c.id = cs.criterion_id
          where cs.card_id = $1 order by cs.idx`, [p.card_id]);
      layouts.add(r.rows.map((x) => x.position).join(','));
    }
    // 12 independent shuffles of 25 items colliding is effectively impossible
    expect(layouts.size).toBe(12);
  });

  it('keeps a layout stable across reloads', async () => {
    const p = await joinPlayer(db, 'Stable', { university: 'aqu' });
    const read = async () => {
      const r = await db.query<{ idx: number; criterion_id: string }>(
        `select idx, criterion_id from card_squares where card_id = $1 order by idx`, [p.card_id]);
      return JSON.stringify(r.rows);
    };
    expect(await read()).toBe(await read());
  });
});
