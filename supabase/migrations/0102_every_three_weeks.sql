-- EVERY THREE WEEKS, AS A SUBSCRIPTION CADENCE.
--
-- Neil, 17 September, off Sahrish Khan's thread. She asked for "a monthly
-- subscription starting on Monday 10/5 and then every 3 weeks", the AI told her
-- correctly that every 3 weeks was not something it could set up, and she
-- settled for monthly. Neil then confirmed every 3 weeks to her by hand, which
-- is what the customer actually wanted and what the system could not do.
--
-- THE GAP WAS REAL AND IT WAS HERE, in the constraint. Nothing above the
-- database had an opinion worth defending: `nextDate()` already counts in whole
-- weeks off the anchor and was generalised away from a hardcoded fortnight when
-- MONTHLY arrived, so 21 days needs no new arithmetic. The AI's tool enum, the
-- website's radio buttons and the summary wording all read one list in
-- src/core/subscription.js. This row is the only thing that could refuse the
-- value outright.
--
-- THREE WEEKS IS NOT AN ODD REQUEST. It is the gap between "every other week is
-- too often" and "once a month is too long", which for somebody who travels for
-- work is exactly where the laundry piles up. The van does not care: every
-- cadence here is a whole number of weeks on a fixed weekday, which is the only
-- shape a weekday route can drive.
--
-- WHY THE VALUE IS SPELLED OUT RATHER THAN NAMED. WEEKLY, FORTNIGHTLY and
-- MONTHLY are words; EVERY_3_WEEKS is not, and that is deliberate. English has
-- no unambiguous single word for it - "triweekly" means both three times a week
-- and once every three weeks, and this value ends up in a sentence a customer
-- reads. A clumsy name that cannot be misread beats a tidy one that can.
--
-- MONTHLY REMAINS 28 DAYS, not a calendar month, and this changes nothing about
-- it. Both are whole weeks on the same weekday for the same reason: a
-- date-based month walks a pickup through all seven weekdays over a year.

alter table recurring_schedules
  drop constraint if exists recurring_cadence_check;

alter table recurring_schedules
  add constraint recurring_cadence_check
  check (cadence in ('WEEKLY', 'FORTNIGHTLY', 'EVERY_3_WEEKS', 'MONTHLY'));

comment on column recurring_schedules.cadence is
  'How often this arrangement collects, as a whole number of weeks on the row''s '
  'own weekday: WEEKLY 7 days, FORTNIGHTLY 14, EVERY_3_WEEKS 21, MONTHLY 28. '
  'The interval and the customer-facing wording both live in '
  'src/core/subscription.js - adding a cadence means adding it there and here.';

-- NOTHING IS BACKFILLED AND NOTHING MOVES. Widening a CHECK cannot invalidate a
-- row that already passed it, and no code writes the new value until the
-- deploy that carries it - so this migration is safe to apply on its own, ahead
-- of the code, and it is safe to leave applied if the code never ships.
--
-- THE REVERSE IS NOT TRUE, which is worth knowing before anybody sets a
-- schedule to EVERY_3_WEEKS by hand. `nextDate()` falls back to WEEKLY for a
-- cadence it does not recognise, so a row carrying this value against code that
-- predates it would be collected every single week. Apply this, deploy the
-- code, and only then change a row.
