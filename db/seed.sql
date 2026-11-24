-- =====================================================================
-- seed.sql — the fixed criteria set for the event, and the university
-- lookup the join form's dropdown reads.
--
-- Text is verbatim from the event brief (Arabic) and must not be reworded. Positions
-- are the printed card's reading order; each player's card is a shuffled
-- permutation of these 25, stored per card at deal time.
--
-- Rules: criterion 4 needs a different university (compared by
-- university_group — Rihan and Jenin are separate groups, so they count
-- as different universities). Everything else, including criterion 7
-- ("was in the previous scholarship"), is honour system between the two
-- people who met — everyone at this event is the 2025-2026 cohort, so
-- there's no player fact to check server-side for that one.
--
-- Idempotent: re-running updates text/rule/labels in place rather than
-- duplicating, so it doubles as the "push my edits" path.
-- =====================================================================

insert into events (slug, name, countdown_seconds)
values ('gsg-clubs', 'DataCamp Scholarship Networking Bingo', 3)
on conflict (slug) do nothing;

-- 'other' is a real row so players.university_value's FK is always
-- satisfiable; its group_key is never read — rpc_join assigns each
-- Other player a unique group of their own.
insert into universities (value, label, group_key, sort_order) values
  ('aqu',        'Al-Quds University (AQU)',                       'aqu',        1),
  ('aaup_rihan', 'Arab American University, Rihan (AAUP)',         'aaup_rihan', 2),
  ('aaup_jenin', 'Arab American University, Jenin (AAUP)',         'aaup_jenin', 3),
  ('hu',         'Hebron University (HU)',                         'hu',         4),
  ('bzu',        'Birzeit University (BZU)',                       'bzu',        5),
  ('ppu',        'Palestine Polytechnic University (PPU)',         'ppu',        6),
  ('nnu',        'An-Najah National University (NNU)',              'nnu',        7),
  ('other',      'Other',                                           'other',      8)
on conflict (value) do update
  set label = excluded.label, group_key = excluded.group_key, sort_order = excluded.sort_order;

insert into criteria (event_id, position, text, rule)
select e.id, v.position, v.text, v.rule
from events e
cross join (values
  (1, 'طالب من جامعة القدس المفتوحة: اسأله عن تخصصه أو مشروع شغال عليه', 'honor'),
  (2, 'طالب من جامعة بيرزيت: اسأله شو أصعب مادة أخدها لهلق؟', 'honor'),
  (3, 'طالب من الجامعة العربية الأمريكية (رام الله): اسأله عن أحلى مكان قعدة بالجامعة', 'honor'),
  (4, 'من جامعة غير جامعتك', 'diff_university'),
  (5, 'جاي من برا رام الله اليوم: سافر من مدينة ثانية عشان يحضر الإيفنت', 'honor'),
  (6, 'وحش الـ XP: جمع أكثر من 10,000 XP على DataCamp', 'honor'),
  (7, 'خلّص كورس أو شهادة على DataCamp هذا الأسبوع', 'honor'),
  (8, 'فريق البايثون: بفضّل Python على باقي لغات البرمجة', 'honor'),
  (9, 'محلل بيانات: بحب SQL أو Power BI أو Excel أكثر من البرمجة', 'honor'),
  (10, 'صاحب مشروع AI: بنى مشروع أو جرّب أداة ذكاء اصطناعي جديدة مؤخراً', 'honor'),
  (11, 'ضحية الفاصلة المنقوطة: سهر للصبح يدور على Bug وطلع الغلط غبي جداً', 'honor'),
  (12, 'صديق ChatGPT: اعتمد عليه بآخر واجب أو مشروع', 'honor'),
  (13, 'مدمن القهوة: شرب فنجانين قهوة أو أكثر قبل ما يوصل الإيفنت', 'honor'),
  (14, 'شغّال ومش فاهم ليش: كتب كود اشتغل وخايف يلمسه', 'honor'),
  (15, 'نسيت أعمل Save: طار شغله لأنه نسي يحفظ الملف', 'honor'),
  (16, 'بشتغل تحت الضغط: سلّم مشروع أو كويز قبل الديدلاين بدقيقة', 'honor'),
  (17, 'حط شهادة DataCamp على الـ CV', 'honor'),
  (18, 'بشتغل بالـ Dark Mode دايماً', 'honor'),
  (19, 'نسخ كود من Stack Overflow وما فهمه', 'honor'),
  (20, 'عنده مشروع على GitHub ما انكمّل', 'honor'),
  (21, 'كتب Query واشتغل من أول مرة', 'honor'),
  (22, 'بحب شغل الـ Terminal', 'honor'),
  (23, 'ضيّع ساعة على مشكلة Indentation', 'honor'),
  (24, 'فاتح أكثر من 20 تبويب هلق', 'honor'),
  (25, 'تخصصه مش حاسوب وبتعلّم برمجة', 'honor')
) as v(position, text, rule)
where e.slug = 'gsg-clubs'
on conflict (event_id, position)
do update set text = excluded.text, rule = excluded.rule, updated_at = now();
