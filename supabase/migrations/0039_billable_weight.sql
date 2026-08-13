-- ---------------------------------------------------------------------------
-- 0039 — two scales decide the price, and a person decides when they disagree.
--
-- NEIL'S CALL, and it reverses an earlier one of his deliberately:
--
--   Both weights within tolerance   bill the HIGHER of the two, charge the
--                                   card straight away, text the customer
--                                   what it came to.
--   Outside tolerance               raise it to Neil. NO charge and NO text
--                                   until he has settled it.
--
-- Until now `partner_weight_lb` was never read by the pricing code at all, and
-- that was the right rule while nothing checked the partner's figure before the
-- money moved. What makes it safe now is the tolerance: a laundromat's scale can
-- only move a bill by less than the tolerance without a person looking at it.
-- Past that it moves nothing until Neil says so. So the control he asked for is
-- still there - it has become a cap rather than a ban.
--
-- IT ALSO MOVES THE CHARGE EARLIER, back off the doorstep. The reason it sat at
-- the door was that a laundromat might read the weight differently AFTER the
-- money had moved, leaving only a refund or an awkward conversation. That window
-- is exactly what settling against both scales closes, so charging on settlement
-- is charging once the disagreement can no longer appear.
--
-- THE BACKSTOP IS THE POINT OF weight_settled_at. A partner entering their
-- figure is voluntary - no signed agreement, an optional page, no login. If
-- "settled" meant "both scales in", an order at a laundromat that never typed
-- anything would be delivered and NEVER CHARGED and the customer would never be
-- told a price. So delivery settles anything still open, on our own scale,
-- which is what happens today.
-- ---------------------------------------------------------------------------

-- What the customer is actually billed for. The higher of the two scales once
-- both are in and agree; ours alone when theirs never came; whatever Neil chose
-- when they disagreed.
--
-- Deliberately NOT the same column as weight_lb. weight_lb is what OUR scale
-- said and stays the driver's own record - it is what a partner's figure is
-- compared against, and overwriting it would destroy the very evidence the
-- comparison is made from.
alter table orders add column if not exists billable_weight_lb numeric(6, 2)
  check (billable_weight_lb is null or billable_weight_lb >= 0);

-- When the price stopped being provisional. Null means the amount can still
-- move, so nothing may be charged and nothing may be texted.
alter table orders add column if not exists weight_settled_at timestamptz;

-- Set when the two scales disagree by more than the tolerance. The order is
-- waiting on a person: no charge, no price text, and it shows on the issues
-- screen. Cleared when Neil settles it.
alter table orders add column if not exists weight_held_at timestamptz;

comment on column orders.billable_weight_lb is
  'The weight the customer is billed on. The HIGHER of ours and the '
  'laundromat''s when both are in and within tolerance; ours alone when theirs '
  'never arrived; whatever a person chose when they disagreed. weight_lb stays '
  'what our scale said and is never overwritten - it is the evidence.';

comment on column orders.weight_settled_at is
  'When the amount stopped being able to move. NOTHING IS CHARGED AND NO PRICE '
  'IS TEXTED BEFORE THIS. Delivery settles anything still open, so an order at '
  'a laundromat that never entered a weight is still billed.';

comment on column orders.weight_held_at is
  'The two scales disagree by more than the tolerance, so the price is waiting '
  'on a person. No charge, no text, and it sits on the issues screen.';
