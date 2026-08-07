-- Move wash & fold from a flat price per bag to a price per pound.
--
-- This changes something fundamental: the price of an order is NOT known when
-- the order is created. Laundry is weighed after collection, so an order now
-- has a price only once a driver has weighed it.
--
-- Everything below follows from that.

-- price_cents becomes the FINAL amount, filled in after weighing. Until then
-- it is genuinely unknown, so it has to be allowed to be empty. Previously it
-- defaulted to 3900 ($39), which would now be a fabricated number sitting on
-- every unweighed order.
alter table orders alter column price_cents drop default;
alter table orders alter column price_cents drop not null;

alter table orders
  -- What the driver weighed, in pounds. Empty until collected and weighed.
  add column if not exists weight_lb numeric(6, 2) check (weight_lb >= 0),

  -- How many bags the customer says they have. Not used for pricing, but the
  -- driver needs to know how many to expect, and "I have two bags" is a normal
  -- thing to text.
  add column if not exists bag_count integer check (bag_count >= 1),

  -- The rate in effect when this order was placed, in cents per pound.
  --
  -- Stored per order on purpose. If the rate ever changes, old orders must
  -- keep the price they were actually quoted at — otherwise last month's
  -- completed orders silently re-price themselves and the books stop adding up.
  add column if not exists price_per_lb_cents integer check (price_per_lb_cents >= 0);

-- An order that has been weighed must have a price, and vice versa. This stops
-- an order being marked delivered with a weight but no charge, or a charge
-- appearing from nowhere.
alter table orders drop constraint if exists orders_weight_and_price_together;
alter table orders add constraint orders_weight_and_price_together
  check ((weight_lb is null) = (price_cents is null));

comment on column orders.weight_lb is 'Weighed after collection. Null until then.';
comment on column orders.price_cents is 'Final charge in whole cents. Null until weighed.';
comment on column orders.price_per_lb_cents is 'Rate at time of order, so historic orders keep their price.';
