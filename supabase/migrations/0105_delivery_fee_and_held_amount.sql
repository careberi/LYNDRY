-- 0105_delivery_fee_and_held_amount.sql
--
-- WHAT THE DRIVING COSTS, AND WHAT WAS ACTUALLY HELD.
--
-- Neil, 25 September: "hold gets placed on order (the hold shouls be at least
-- the amount of the delivery). Then once the luandromat weights the order, the
-- card should be charged."
--
-- Three columns, and the middle one is the one that would have gone wrong
-- silently.

-- ---------------------------------------------------------------------------
-- What the customer pays for the driving
-- ---------------------------------------------------------------------------
--
-- SNAPSHOTTED AT BOOKING, exactly like `price_per_lb_cents` and for exactly the
-- same reason: changing a price must not re-price work already quoted. A courier
-- quote is good for fifteen minutes and their fee moves with their own routed
-- distance, so the number a customer was told is a fact about the moment they
-- booked and cannot be recomputed later.
--
-- NULL IS A REAL STATE. Every order taken under the van has no delivery fee
-- because there was no delivery to charge for - we drove. Reading null as zero
-- is correct for those and must stay correct.
alter table orders add column if not exists delivery_fee_cents integer;

comment on column orders.delivery_fee_cents is
  'What the customer is charged for the courier, both legs, grossed up for '
  'Stripe. Snapshotted when the order is booked. Null for van-era orders.';

-- ---------------------------------------------------------------------------
-- What we expect to pay for it
-- ---------------------------------------------------------------------------
--
-- NOT THE SAME NUMBER, and keeping both is the only way to know whether a round
-- is worth doing. The customer's fee is two legs grossed up for Stripe; this is
-- what the courier quoted us. The gap between them is not margin - it is
-- Stripe's cut, which is why the fee is grossed up at all.
alter table orders add column if not exists courier_cost_cents integer;

comment on column orders.courier_cost_cents is
  'What the courier quoted us for both legs, in cents, at booking. What we '
  'expect to pay, against delivery_fee_cents which is what the customer pays.';

-- ---------------------------------------------------------------------------
-- What was actually held
-- ---------------------------------------------------------------------------
--
-- THIS IS THE ONE THAT WOULD HAVE BROKEN QUIETLY.
--
-- The show-up hold has always been a flat $25 read out of
-- `config.pricing.authorizationCents`, so nothing needed to remember the amount:
-- the capture read the same constant the authorization did, and the two could
-- not disagree.
--
-- The moment the hold becomes "at least the amount of the delivery" it is a
-- number per order. A capture that still read the config would capture today's
-- figure against a hold placed last week at a different one - and Stripe refuses
-- a capture larger than the authorization, so the failure would be a refused
-- capture on a card that was perfectly good.
--
-- SO THE AMOUNT LIVES WITH THE AUTHORIZATION IT BELONGS TO. Written beside
-- `authorization_intent_id` and cleared with it.
--
-- NULL MEANS THE FLAT FLOOR, which is what every existing held order was placed
-- at. Backfilling a number would be inventing a fact; reading null as the
-- constant is what those orders were actually held at.
alter table orders add column if not exists authorization_amount_cents integer;

comment on column orders.authorization_amount_cents is
  'What was actually authorized, in cents. Null means the flat floor in '
  'config.pricing.authorizationCents, which is what every order held before '
  'this column existed was placed at. A capture must never read the config.';
