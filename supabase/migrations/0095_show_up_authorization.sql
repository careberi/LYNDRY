-- ---------------------------------------------------------------------------
-- 0095 - the $25 show-up hold, placed before a pickup is confirmed
-- ---------------------------------------------------------------------------
--
-- Neil, 14 September. $25, down from the $50 and $80 that were discussed and
-- never built. The card must ACCEPT the hold before a pickup is confirmed -
-- money held, not taken - and what it buys is the trip: a van leaving with a
-- driver in it costs the same whether or not there is a bag on the step.
--
-- At the door the real total is worked out:
--
--   total is $25 or less   capture that much of the hold and no more; Stripe
--                          releases the rest
--   total is more          capture the $25 and charge the remainder on the
--                          same card
--   the remainder refused  KEEP the $25, leave the bags, wash nothing
--
-- THE LAST LINE IS WHY THIS IS NOT A DEPOSIT. A deposit comes back or turns
-- into credit. This does neither: the trip happened. payments.applies_to_wash
-- is what keeps it out of the price of a wash that never took place, including
-- the rebooked one tomorrow.
--
-- IT IS NOT THE PAYMENT HOLD. That one is a state an order is IN - we have the
-- laundry and a charge failed - and is derived, never stored. This is a real
-- authorization at Stripe with an id, and it exists before anybody has
-- collected anything. The two never overlap: a doorstep refusal leaves the
-- bags on the step, so there is nothing to hold.
-- ---------------------------------------------------------------------------

alter table orders
  -- The Stripe PaymentIntent sitting in requires_capture. Null once captured
  -- or released, so "is there a live hold on this order" is one null check.
  add column if not exists authorization_intent_id text,
  -- What was held, in cents. Read rather than assumed from config, because the
  -- amount could change between a booking and its doorstep and the hold that
  -- exists is the one that was agreed.
  add column if not exists authorized_cents integer,
  add column if not exists authorized_at timestamptz,
  -- What was actually taken from it, and when. Kept after the intent id is
  -- cleared: this is the record that the trip was paid for.
  add column if not exists captured_cents integer,
  add column if not exists captured_at timestamptz,

  -- THE CARD SAID NO. This is what makes the rule a gate rather than a badge:
  -- collectable() keeps a refused pickup off the round, the same way it already
  -- does for an order with no card at all.
  --
  -- IT IS SEPARATE FROM "NEVER ASKED", and that separation is the whole reason
  -- it is a column. Every order taken before today has no hold on it, and a
  -- gate that read a missing hold as a refusal would empty the round on the
  -- morning this deploys. Null here means nobody asked, which is what those
  -- orders have always meant.
  add column if not exists authorization_refused_at timestamptz,
  add column if not exists authorization_refused_reason text,

  -- Same job as payment_attempts, and for the same Stripe reason: an
  -- idempotency key caches its RESULT, including a refusal, so a key without an
  -- attempt number replays "declined" at somebody who has since fixed the card.
  add column if not exists authorization_attempts integer not null default 0;

comment on column orders.authorization_intent_id is
  'A live $25 show-up hold at Stripe, in requires_capture. Null when there is no live hold - never placed, already captured, or released.';

comment on column orders.captured_cents is
  'What was taken from the show-up hold. Survives the intent id being cleared, because it is the record that the trip was paid for even when the bags were left behind.';

comment on column orders.authorization_refused_at is
  'The card was asked for the show-up hold and refused it. Null means nobody asked - which is every order placed before this existed, and is why a missing hold is not a refusal.';
