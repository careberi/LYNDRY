-- SUBSCRIPTIONS: $1.80 A POUND, AGAINST $2.00 FOR A ONE-TIME PICKUP.
--
-- Neil's decision lock, 15 September. Two things land here and neither of them
-- is a new table.
--
-- A SUBSCRIPTION IS A STANDING ORDER. `recurring_schedules` already holds one
-- row per arrangement, already has ACTIVE / PAUSED / ENDED, and already counts
-- a cadence from an anchor. Adding a `subscriptions` table beside it would be a
-- second copy of the same fact, free to disagree the first time anybody edited
-- one - which is the thing this codebase refuses everywhere else. So a
-- subscription IS a schedule, and everything below is the two columns that were
-- genuinely missing.
--
-- WHAT IS ACTUALLY NEW:
--
--   1. MONTHLY, because the cadence CHECK only allowed WEEKLY and FORTNIGHTLY.
--   2. orders.subscription_id, because an order has never known WHICH
--      arrangement it belongs to - only `from_schedule`, a boolean saying the
--      nightly pass created it.
--
-- THOSE TWO FACTS ARE NOT THE SAME FACT, which is why this is a new column
-- rather than a reuse:
--
--   from_schedule    HOW it was created - the nightly pass made it, nobody asked
--   subscription_id  WHICH plan it is priced and counted under
--
-- Neil's rule needs both and they come apart in two real directions. A customer
-- with an active subscription who books an EXTRA pickup gets one-time pricing -
-- subscription_id null, from_schedule false. An admin or a customer may
-- deliberately add a pickup to the subscription - subscription_id set,
-- from_schedule false, because nothing automatic created it.
--
-- WHY THE RATE IS NOT STORED HERE. orders.price_per_lb_cents already snapshots
-- what a pickup was quoted at, and has since the beginning, precisely so that
-- changing a price cannot re-price work already done. That column is what makes
-- Neil's hardest rule true for free: a customer who subscribes, takes one
-- pickup and cancels the same day keeps $1.80 on that pickup, because the $1.80
-- is written on the order and cancelling does not go back and touch it. There
-- is nothing to re-price, so nothing can.

-- --- 1. Every month -------------------------------------------------------
--
-- MONTHLY is every FOUR WEEKS on the same weekday, not the same date each
-- month. The whole model is weekday-based - `weekday` is a column, the van runs
-- a weekday route, and the fortnightly anchor already counts in whole weeks -
-- and a date-based month would walk the pickup through all seven weekdays over
-- a year, which is not a round anybody drives. It is 13 pickups a year rather
-- than 12.

alter table recurring_schedules
  drop constraint if exists recurring_cadence_check;

alter table recurring_schedules
  add constraint recurring_cadence_check
  check (cadence in ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY'));

comment on column recurring_schedules.cadence is
  'WEEKLY, FORTNIGHTLY or MONTHLY. Counted in whole weeks from started_on - '
  'MONTHLY is every four weeks on the same weekday, because the route is '
  'weekday-based and a date-based month would move the pickup across weekdays.';

-- --- 2. Which subscription an order belongs to ------------------------------
--
-- Nullable, and null is the ordinary state: a one-time pickup belongs to no
-- subscription and is charged the one-time rate. Every order that exists today
-- is one of those, which is correct - nobody has been sold a subscription yet.
--
-- ON DELETE SET NULL rather than CASCADE. Deleting a schedule must never delete
-- the orders it booked: those are real pickups that really happened, and the
-- money is on them. Losing which plan an old order belonged to is a reporting
-- cost; losing the order is not a cost anybody would accept. In practice a
-- subscription is ENDED rather than deleted, so this is the belt on the braces.

alter table orders
  add column if not exists subscription_id uuid
  references recurring_schedules(id) on delete set null;

create index if not exists orders_subscription_idx
  on orders (subscription_id) where subscription_id is not null;

comment on column orders.subscription_id is
  'The subscription this pickup is priced and counted under, or null for a '
  'one-time pickup. NOT the same as from_schedule, which says only that the '
  'nightly pass created it: an extra pickup booked by a subscriber is '
  'from_schedule false and subscription_id null, and a pickup deliberately '
  'added to the plan is from_schedule false and subscription_id set.';
