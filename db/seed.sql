-- =====================================================================
-- seed.sql — the fixed criteria set for the event.
--
-- Text is verbatim from the brief and must not be reworded. Positions
-- are the printed card's reading order; each player's card is a shuffled
-- permutation of these 25, stored per card at deal time.
--
-- Rules: criterion 1 needs a different university. Criterion 22 needs a
-- different club, where a club is (university, club) — so IEEE at one
-- university and IEEE at another are different clubs, and two different
-- clubs at the same university also match. Everything else is honour
-- system between the two people who met.
--
-- Idempotent: re-running updates text/rule in place rather than
-- duplicating, so it doubles as the "push my criteria edits" path.
-- =====================================================================

insert into events (slug, name, countdown_seconds)
values ('gsg-clubs', 'GSG Clubs Networking Bingo', 3)
on conflict (slug) do nothing;

insert into criteria (event_id, position, text, rule)
select e.id, v.position, v.text, v.rule
from events e
cross join (values
  (1,  'Is from a different university than you',                                        'diff_university'),
  (2,  'Wants to organize a joint event with another university',                        'honor'),
  (3,  'Find someone who can speak more than two languages',                             'honor'),
  (4,  'Find someone who has an idea they have never had the chance to try',             'honor'),
  (5,  'Find someone who has a hidden talent',                                           'honor'),
  (6,  'Has been a club leader for more than one year',                                  'honor'),
  (7,  'Find someone who has won or placed in a competition',                            'honor'),
  (8,  'Has organized a hackathon',                                                      'honor'),
  (9,  'Has participated in a programming competition',                                  'honor'),
  (10, 'Has organized an event with 100+ participants',                                  'honor'),
  (11, 'Has organized an event outside their university',                                'honor'),
  (12, 'Find someone who would rather organize an event than attend one',                'honor'),
  (13, 'Can offer technical training to another club',                                   'honor'),
  (14, 'Knows a really good speaker or trainer they could recommend',                    'honor'),
  (15, 'Find someone who joined their club without knowing what they were getting into', 'honor'),
  (16, 'Find someone who joined their club because of a friend',                         'honor'),
  (17, 'Has an idea for a new club activity',                                            'honor'),
  (18, 'Has attended a GSG program',                                                     'honor'),
  (19, 'Find someone who woke up before 7 AM to come here',                              'honor'),
  (20, 'Is looking for a speaker for an upcoming event',                                 'honor'),
  (21, 'Find someone who has a club tradition they are proud of',                        'honor'),
  (22, 'Has collaborated with another university club',                                  'diff_club_entity'),
  (23, 'Is joining from Gaza',                                                           'honor'),
  (24, 'Find someone who can recommend a really good Palestinian food spot',             'honor'),
  (25, 'Find someone who has spoken in front of 100+ people',                            'honor')
) as v(position, text, rule)
where e.slug = 'gsg-clubs'
on conflict (event_id, position)
do update set text = excluded.text, rule = excluded.rule, updated_at = now();
