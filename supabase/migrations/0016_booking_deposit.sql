-- The minimum, taken at booking.
--
-- Wash and fold is priced by weight, so the real total does not exist until a
-- bag is on the scale. That left the whole exposure on the far side of the
-- work: we collected, washed, folded, delivered, and only then found out
-- whether the card worked.
--
-- So there is now a minimum, charged when the pickup is booked:
--
--   booking     $25 taken immediately
--   weigh-in    total = max($25, weight x rate), and we charge the difference
--
-- $25 is exactly 10 lb at $2.50. It is a genuine MINIMUM, not a deposit: an
-- 8 lb load costs $25 and nothing is refunded, because a small load still
-- costs a full pickup and a full delivery. That has to be said plainly on the
-- website and on the payment page, before anybody's card is touched.
--
-- Consequences worth knowing:
--   - an order is not confirmed until deposit_paid_at is set. Until then it
--     stays off the driver's run sheet, because nobody should drive to a door
--     for a booking that was never paid for.
--   - cancelling before collection refunds the minimum, because "free until
--     the driver collects" is already promised on the website.

alter table orders
  add column if not exists deposit_cents        integer,
  add column if not exists deposit_paid_at      timestamptz,
  add column if not exists deposit_refunded_at  timestamptz,
  add column if not exists deposit_intent_id    text;

-- Money is always whole cents and never negative.
alter table orders
  drop constraint if exists orders_deposit_cents_check;

alter table orders
  add constraint orders_deposit_cents_check
  check (deposit_cents is null or deposit_cents >= 0);

-- Orders that predate this were never charged a minimum, and backfilling one
-- would claim we took money we did not take. They stay null.

comment on column orders.deposit_cents is
  'The minimum charged when this pickup was booked, in cents. Null on orders '
  'that predate the minimum. Subtracted from the final total at weigh-in.';
comment on column orders.deposit_paid_at is
  'When the minimum actually cleared. Null means the booking is not confirmed '
  'yet and must stay off the run sheet.';
comment on column orders.deposit_refunded_at is
  'When the minimum was given back, which happens on a cancellation before '
  'collection.';
comment on column orders.deposit_intent_id is
  'The payment provider reference for the deposit charge, so it can be '
  'refunded without searching for it.';
