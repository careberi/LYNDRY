-- Record the minimum this order was booked under.
--
-- price_cents was being set to weight x rate with no floor, so a 10 lb order
-- at $2.00 recorded $20.00 while the customer was actually charged the $25.00
-- minimum. The order under-reported its own revenue, and every total built on
-- it - the board, lifetime billed, anything Neil adds later - was wrong by the
-- difference.
--
-- Stored on the order for exactly the same reason price_per_lb_cents is:
-- changing the minimum next month must not silently re-price work already
-- quoted. An order is priced under the terms it was booked under, and both
-- halves of those terms now live on the row.
--
-- Nullable, because orders taken before the minimum existed were genuinely not
-- subject to one and back-filling would invent a term nobody agreed to.

alter table orders
  add column if not exists minimum_cents integer;

alter table orders
  drop constraint if exists orders_minimum_cents_check;

alter table orders
  add constraint orders_minimum_cents_check
  check (minimum_cents is null or minimum_cents >= 0);

-- Orders that already paid a minimum were booked under exactly that figure,
-- so it can be recovered rather than guessed.
update orders
   set minimum_cents = deposit_cents
 where minimum_cents is null
   and deposit_cents is not null;

comment on column orders.minimum_cents is
  'The minimum charge this order was booked under, in cents. price_cents is '
  'never lower than this. Stored per order so changing the minimum later '
  'cannot re-price work already quoted, exactly like price_per_lb_cents.';
