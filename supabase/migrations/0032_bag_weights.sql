-- ---------------------------------------------------------------------------
-- 0032 — a bag has its own weight.
--
-- The guided run asked for stickers first and a single weight afterwards, which
-- is not how a driver actually stands at a door. He holds ONE bag: he sticks a
-- label on it, puts it on the scale, writes the number down, and picks up the
-- next one. Asking for stickers before anybody has said how many bags there are
-- is asking a question out of order.
--
-- So the run asks how many bags first, then walks them one at a time, and the
-- weight lands on the bag rather than on the order.
--
-- `orders.weight_lb` STAYS AND STAYS AUTHORITATIVE - it is what prices the
-- order, what the customer is told, and what the laundromat's figure is checked
-- against. It becomes the SUM of the bags rather than a number typed once. One
-- place still decides the price; it just adds up now.
--
-- Keeping the per-bag figures rather than only the total is worth the column on
-- its own: "which bag was the 40 lb one" is answerable at a door, and a scale
-- photo per bag is better evidence than one photo of a pile.
-- ---------------------------------------------------------------------------

alter table bag_labels add column if not exists weight_lb numeric(6, 2)
  check (weight_lb is null or weight_lb >= 0);

alter table bag_labels add column if not exists weighed_at timestamptz;

-- Same private bucket as the order-level scale photo. A photo of the display
-- with the bag on it is what settles an argument about the number later.
alter table bag_labels add column if not exists weight_photo_path text;

comment on column bag_labels.weight_lb is
  'What this one bag weighed. orders.weight_lb is the sum of these and is still '
  'what prices the order.';

comment on column bag_labels.weighed_at is
  'When it went on the scale. Null means this bag has not been weighed yet, '
  'which is what the guided run walks the driver through.';
