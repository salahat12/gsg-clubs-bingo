-- =====================================================================
-- seed.sql — the fixed criteria set for the event, and the university
-- lookup the join form's dropdown reads.
--
-- Text is verbatim from the brief and must not be reworded. Positions
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
  (1,  'Has completed the current phase of their university at DataCamp',                'honor'),
  (2,  'Has participated in a DataCamp competition or hackathon',                        'honor'),
  (3,  'Passed the Data Literacy certificate',                                           'honor'),
  (4,  'Is from a different university than you',                                        'diff_university'),
  (5,  'Has built AI projects outside DataCamp',                                          'honor'),
  (6,  'Joined DataCamp without knowing what they were getting into',                     'honor'),
  (7,  'Was in the previous scholarship (2024-2025)',                                     'honor'),
  (8,  'Started before you and can say what they would do differently',                   'honor'),
  (9,  'Has restarted the same course more than once',                                    'honor'),
  (10, 'Went a full month without opening DataCamp and came back',                        'honor'),
  (11, 'Has failed an exam on DataCamp',                                                  'honor'),
  (12, 'Could not complete a course and skipped it',                                      'honor'),
  (13, 'Almost dropped out and did not',                                                  'honor'),
  (14, 'Has used something learned from DataCamp outside the platform',                   'honor'),
  (15, 'Has the longest streak in the room',                                              'honor'),
  (16, 'Cheated a little on an exercise and felt bad about it',                           'honor'),
  (17, 'Still does not fully understand something they passed',                           'honor'),
  (18, 'Finished a track and immediately forgot most of it',                              'honor'),
  (19, 'Has an error message they will never forget',                                     'honor'),
  (20, 'Does their best work after midnight',                                             'honor'),
  (21, 'Has never asked anyone in the program for help',                                  'honor'),
  (22, 'Explained something wrong to someone confidently',                                'honor'),
  (23, 'Would take the whole program again differently',                                  'honor'),
  (24, 'Has a resource outside DataCamp worth stealing',                                  'honor'),
  (25, 'Has a study routine worth copying',                                               'honor')
) as v(position, text, rule)
where e.slug = 'gsg-clubs'
on conflict (event_id, position)
do update set text = excluded.text, rule = excluded.rule, updated_at = now();
