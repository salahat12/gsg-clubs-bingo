import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, joinPlayer } from './harness';

/**
 * The 25 criteria, transcribed from the brief. The brief says "exact, do
 * not rewrite", so this test is the guard on that: if anyone tidies a
 * word in the seed, this fails.
 */
const CRITERIA: Array<[number, string]> = [
  [1,  'Is from a different university than you'],
  [2,  'Wants to organize a joint event with another university'],
  [3,  'Find someone who can speak more than two languages'],
  [4,  'Find someone who has an idea they have never had the chance to try'],
  [5,  'Find someone who has a hidden talent'],
  [6,  'Has been a club leader for more than one year'],
  [7,  'Find someone who has won or placed in a competition'],
  [8,  'Has organized a hackathon'],
  [9,  'Has participated in a programming competition'],
  [10, 'Has organized an event with 100+ participants'],
  [11, 'Has organized an event outside their university'],
  [12, 'Find someone who would rather organize an event than attend one'],
  [13, 'Can offer technical training to another club'],
  [14, 'Knows a really good speaker or trainer they could recommend'],
  [15, 'Find someone who joined their club without knowing what they were getting into'],
  [16, 'Find someone who joined their club because of a friend'],
  [17, 'Has an idea for a new club activity'],
  [18, 'Has attended a GSG program'],
  [19, 'Find someone who woke up before 7 AM to come here'],
  [20, 'Is looking for a speaker for an upcoming event'],
  [21, 'Find someone who has a club tradition they are proud of'],
  [22, 'Has collaborated with another university club'],
  [23, 'Is joining from Gaza'],
  [24, 'Find someone who can recommend a really good Palestinian food spot'],
  [25, 'Find someone who has spoken in front of 100+ people'],
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

  it('marks only criteria 1 and 22 as machine-checkable', async () => {
    const r = await db.query<{ position: number; rule: string }>(
      `select position, rule from criteria where rule <> 'honor' order by position`);
    expect(r.rows).toEqual([
      { position: 1,  rule: 'diff_university' },
      { position: 22, rule: 'diff_club_entity' },
    ]);
  });

  it('re-running the seed updates in place rather than duplicating', async () => {
    const { readFileSync } = await import('node:fs');
    await db.exec(readFileSync('db/seed.sql', 'utf8'));
    const r = await db.query<{ n: number }>(`select count(*)::int n from criteria`);
    expect(r.rows[0].n).toBe(25);
  });

  it('deals every criterion exactly once per card', async () => {
    const p = await joinPlayer(db, 'Bara', 'IUG', 'GDSC');
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
      const p = await joinPlayer(db, `P${i}`, 'IUG', 'GDSC');
      const r = await db.query<{ position: number }>(
        `select c.position from card_squares cs join criteria c on c.id = cs.criterion_id
          where cs.card_id = $1 order by cs.idx`, [p.card_id]);
      layouts.add(r.rows.map((x) => x.position).join(','));
    }
    // 12 independent shuffles of 25 items colliding is effectively impossible
    expect(layouts.size).toBe(12);
  });

  it('keeps a layout stable across reloads', async () => {
    const p = await joinPlayer(db, 'Stable', 'IUG', 'GDSC');
    const read = async () => {
      const r = await db.query<{ idx: number; criterion_id: string }>(
        `select idx, criterion_id from card_squares where card_id = $1 order by idx`, [p.card_id]);
      return JSON.stringify(r.rows);
    };
    expect(await read()).toBe(await read());
  });
});
