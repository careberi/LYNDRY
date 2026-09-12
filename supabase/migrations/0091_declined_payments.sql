-- ---------------------------------------------------------------------------
-- 0091 — a declined payment is followed up, and we write down why it declined
-- ---------------------------------------------------------------------------
--
-- Order #2060, 12 September. The laundromat weighed it, the card was refused,
-- the customer was told straight away, and then nothing else happened at all:
-- no screen offered to try it again, and no sweep ever asked about it. An
-- unpaid order could sit there for ever as long as nobody remembered it.
--
-- payment_decline_code is the issuer's own code, which the provider has always
-- read off the error and always thrown away. What was stored instead was
-- Stripe's sentence for cardholders - for #2060 that is "The payment failed.",
-- which is true and says nothing. The code behind it separates "they have no
-- money today" from "this card cannot be charged while they are not there",
-- and those two need different answers from a person.
--
-- payment_chase_sent_at is the same shape as orders.card_link_sent_at and
-- orders.reminder_sent_at: ONE chase, ever, per order, and the column is what
-- makes a second one impossible rather than merely discouraged. Stamped after
-- the send, never before, so a carrier having a bad minute costs one duplicate
-- rather than silence.
-- ---------------------------------------------------------------------------

alter table orders
  add column if not exists payment_decline_code text,
  add column if not exists payment_chase_sent_at timestamptz;

comment on column orders.payment_decline_code is
  'The issuer''s own decline code, when they gave one. Evidence and a hint, '
  'never a rule: nothing routes on it. payment_failure_reason is the sentence '
  'a customer may be shown; this is the machine answer behind it.';

comment on column orders.payment_chase_sent_at is
  'When we chased this order''s failed payment. One chase per order, for ever. '
  'See src/core/payment-chase.js.';
