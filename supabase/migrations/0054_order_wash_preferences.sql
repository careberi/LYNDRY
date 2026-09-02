-- ---------------------------------------------------------------------------
-- THE WASH DETAILS BELONG TO THE ORDER, NOT ONLY TO THE PERSON.
--
-- Wash preferences lived in one place: customers.preferences. That was right
-- while a customer could only have one pickup outstanding, and wrong the moment
-- Neil allowed a second one on the same day:
--
--   "We just need to make sure that the wash details for the two orders remain
--    separate, and the previous wash details update the account of the person."
--
-- Without this, a customer who books a second load at 5pm with different
-- details rewrites what the laundromat sees for the load collected at 2pm -
-- which is already at a counter, on a shelf, being washed to instructions that
-- silently changed underneath it. The QR page reads from the customer row, so
-- the bag in somebody's hands would simply start saying something else.
--
-- Snapshotted at booking. NULL on every order taken before this column existed,
-- which is why every reader falls back to the customer row rather than treating
-- null as "no preferences" - that would blank the wash instructions on live
-- orders, which is the one thing a laundromat cannot work around.
--
-- The account still updates. Neil's rule, and it is the sensible half: the
-- newest choices become the customer's defaults for next time, while the orders
-- already placed keep the details they were placed with.
-- ---------------------------------------------------------------------------

alter table orders add column if not exists preferences jsonb;

comment on column orders.preferences is
  'The wash details THIS order was booked with, snapshotted at booking. Null on '
  'orders taken before this column existed, which fall back to the customer row.';
