-- ---------------------------------------------------------------------------
-- 0036 — the laundromat weighs each BAG, not the order.
--
-- `orders.partner_weight_lb` was a single column, so a three-bag order had one
-- place to put a partner's figure. Scanning bag 1's sticker and typing a weight
-- set it for the whole order, and bag 2's page then showed the same number back
-- as though it had been weighed too. Neil found it by weighing one bag and
-- watching both change.
--
-- A laundromat weighs what is in front of them, which is one bag. So the figure
-- belongs on the bag, and the comparison that matters is TOTAL against TOTAL:
-- the sum of their bags against the one number our driver wrote down.
--
-- `orders.partner_weight_lb` stays and keeps its meaning - it is what our
-- weight is checked against, and what the partner-drift history reads. It is
-- now the SUM of the bags, written only once every bag has been weighed. A
-- half-weighed order must not be compared against a full one; that would flag
-- every laundromat as light.
-- ---------------------------------------------------------------------------

alter table bag_labels add column if not exists partner_weight_lb numeric(6, 2)
  check (partner_weight_lb is null or partner_weight_lb >= 0);

alter table bag_labels add column if not exists partner_weight_at timestamptz;

comment on column bag_labels.partner_weight_lb is
  'What the laundromat''s own scale said about THIS bag. orders.partner_weight_lb '
  'is the sum of these, and is only set once every bag on the order has one.';

comment on column bag_labels.partner_weight_at is
  'When they weighed it. Null means this bag is still waiting to go on their '
  'scale, which is what the QR page asks for.';
