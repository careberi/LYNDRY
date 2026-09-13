-- ---------------------------------------------------------------------------
-- 0092 — a standing order remembers which door it was set up at
-- ---------------------------------------------------------------------------
--
-- Neil, 12 September, on order #2060: the customer did everything on the
-- website and we then texted him a link asking him to update his card. His
-- words: "we're switching between two platforms... this can just come off as
-- spam." He is right, and it is the same principle he set with
-- booking.DOORS - which door an order came through decides how we talk about
-- it - carried one step further, from the voice of a message to where it
-- sends somebody.
--
-- THE DOOR WAS ALREADY ON THE ORDER AND WAS NULL FOR EXACTLY THIS CUSTOMER.
-- orders.placed_via (migration 0083) records THREAD, WEB or PHONE, but a
-- pickup booked from a standing order passes none of them, so #2060 - which
-- was placed on the website, in the wizard, along with the schedule itself -
-- reads as null. Null is genuinely ambiguous: a thread booking, an old order,
-- or a web one that came through a schedule.
--
-- So the schedule carries it, and orders booked from the schedule inherit it.
-- A standing order is an arrangement made at a particular door, and the
-- pickups it books are that arrangement happening.
--
-- BACKFILLED TO WEB, and that is a fact rather than a guess:
-- recurring.addSchedule() has exactly one caller, the booking wizard in
-- src/routes/account.js. The AI has no tool that makes a schedule and there is
-- no ops screen for one, so every row that exists today was made on the
-- website.
-- ---------------------------------------------------------------------------

alter table recurring_schedules
  add column if not exists placed_via text
  check (placed_via is null or placed_via in ('THREAD', 'WEB', 'PHONE'));

update recurring_schedules set placed_via = 'WEB' where placed_via is null;

comment on column recurring_schedules.placed_via is
  'Where this arrangement was set up. Copied onto every pickup it books, so a '
  'customer who has only ever used the website is not sent a payment link by '
  'text. See billing.fixCardLine().';

-- And the pickups those arrangements have already booked. Every one of them
-- reads null today, which is indistinguishable from a thread booking - and
-- order #2060, placed in the wizard along with its schedule, is exactly the
-- order that got sent a payment link by text as a result.
--
-- Safe because every schedule is WEB (see above), so a customer with two
-- schedules cannot be given two different answers. The day that stops being
-- true, this backfill is already done and does not run again.
update orders o
set placed_via = s.placed_via
from recurring_schedules s
where o.customer_id = s.customer_id
  and o.from_schedule = true
  and o.placed_via is null
  and s.placed_via is not null;
