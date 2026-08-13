-- ---------------------------------------------------------------------------
-- 0031 — one open pickup PER DAY, not one in total.
--
-- A customer booked Thursday, then asked for a second pickup on Friday. The AI
-- recapped it correctly, they said yes, and the booking was refused - because
-- since 0001 a customer could have exactly one order awaiting collection, full
-- stop. It ended in a handoff to a human for something the business obviously
-- wants to say yes to.
--
-- THE REASON FOR THE OLD RULE IS GONE. 0001 says it plainly: it existed so
-- open_locker() could resolve which compartment to open from a phone number
-- alone, and there had to be exactly one answer. Lockers are shelved - the
-- hardware does not work, nothing on the website mentions one, and
-- open_locker() refuses politely on every call. The constraint outlived the
-- feature it was protecting.
--
-- ONE PER DAY IS STILL RIGHT, though, and is not the same thing as one in
-- total. A van makes one visit to a door on a given day, so two open pickups on
-- the same date is a mistake rather than a request - it is exactly the rule
-- recurring schedules already follow ("two schedules on the same day is one
-- pickup, not two"). It also keeps "your Thursday pickup" unambiguous, which is
-- what reschedule and cancel need in order to act without asking twice.
--
-- Orders already being washed or delivered are excluded, as before: a customer
-- can book while a previous load is still with us.
-- ---------------------------------------------------------------------------

drop index if exists orders_one_open_per_customer;

create unique index if not exists orders_one_open_per_customer_per_day
  on orders (customer_id, pickup_date)
  where status in ('REQUESTED', 'ASSIGNED', 'DEPOSITED');

comment on index orders_one_open_per_customer_per_day is
  'A customer may have several pickups booked, but only one on any given day - '
  'the van makes one visit to a door. Replaced a one-per-customer index that '
  'existed for open_locker(), which is shelved.';
