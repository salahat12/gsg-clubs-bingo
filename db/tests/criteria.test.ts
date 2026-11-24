import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, joinPlayer } from './harness';

/**
 * The 25 criteria, transcribed from the brief. The brief says "exact, do
 * not rewrite", so this test is the guard on that: if anyone tidies a
 * word in the seed, this fails.
 */
const CRITERIA: Array<[number, string]> = [
  [1, 'طالب من جامعة القدس المفتوحة: اسأله عن تخصصه أو مشروع شغال عليه'],
  [2, 'طالب من جامعة بيرزيت: اسأله شو أصعب مادة أخدها لهلق؟'],
  [3, 'طالب من الجامعة العربية الأمريكية (رام الله): اسأله عن أحلى مكان قعدة بالجامعة'],
  [4, 'من جامعة غير جامعتك'],
  [5, 'جاي من برا رام الله اليوم: سافر من مدينة ثانية عشان يحضر الإيفنت'],
  [6, 'وحش الـ XP: جمع أكثر من 10,000 XP على DataCamp'],
  [7, 'خلّص كورس أو شهادة على DataCamp هذا الأسبوع'],
  [8, 'فريق البايثون: بفضّل Python على باقي لغات البرمجة'],
  [9, 'محلل بيانات: بحب SQL أو Power BI أو Excel أكثر من البرمجة'],
  [10, 'صاحب مشروع AI: بنى مشروع أو جرّب أداة ذكاء اصطناعي جديدة مؤخراً'],
  [11, 'ضحية الفاصلة المنقوطة: سهر للصبح يدور على Bug وطلع الغلط غبي جداً'],
  [12, 'صديق ChatGPT: اعتمد عليه بآخر واجب أو مشروع'],
  [13, 'مدمن القهوة: شرب فنجانين قهوة أو أكثر قبل ما يوصل الإيفنت'],
  [14, 'شغّال ومش فاهم ليش: كتب كود اشتغل وخايف يلمسه'],
  [15, 'نسيت أعمل Save: طار شغله لأنه نسي يحفظ الملف'],
  [16, 'بشتغل تحت الضغط: سلّم مشروع أو كويز قبل الديدلاين بدقيقة'],
  [17, 'حط شهادة DataCamp على الـ CV'],
  [18, 'بشتغل بالـ Dark Mode دايماً'],
  [19, 'نسخ كود من Stack Overflow وما فهمه'],
  [20, 'عنده مشروع على GitHub ما انكمّل'],
  [21, 'كتب Query واشتغل من أول مرة'],
  [22, 'بحب شغل الـ Terminal'],
  [23, 'ضيّع ساعة على مشكلة Indentation'],
  [24, 'فاتح أكثر من 20 تبويب هلق'],
  [25, 'تخصصه مش حاسوب وبتعلّم برمجة'],
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
