-- ---------------------------------------------------------------------------
-- 0044 — bag tags with numbered stickers, and paid wash options.
--
-- NEIL'S REVISED PROCESS. Two changes that arrive together because they both
-- land on the same rows.
--
-- === BAG TAGS ==============================================================
--
-- A BAG TAG IS A PHYSICAL TAG CARRYING FOUR PEELABLE STICKERS. All four print
-- the same bag tag id, and each also carries a SEQUENCE - 7MQ5Y2-1 through -4.
--
-- The sequence is the whole point, and it is what makes the return leg work.
-- One intake bag becomes any number of output bags: the laundromat empties it,
-- washes the contents, and packs them into however many of their own bags it
-- takes. Each of those gets one sticker off the tag.
--
-- Without a sequence, four identical stickers cannot be told apart, and three
-- things break:
--
--   a repeat scan is indistinguishable from a second bag
--   the system never learns how many bags the wash became
--   "sub bag 2 is ready" is an inference from scan order rather than a fact
--
-- With it, each sticker is individually addressable while the id a person says
-- out loud stays the same on all four.
--
-- This deliberately REVERSES the single order tag added in 0043. That model
-- was right about the wash instructions being per order, and wrong that a bag
-- needed no identity of its own - the four stickers solve the repacking problem
-- the old per-bag codes could not. orders.tag_code stays and still resolves, so
-- nothing already printed stops working.
--
-- === PAID WASH OPTIONS =====================================================
--
-- Detergent and softener become choices with prices attached:
--
--   Detergent  Standard Scented          included
--              Free & Clear              +$2
--   Softener   Standard Scented          included
--              No Softener               included
--              Fragrance-Free            +$2
--
-- The surcharge is FROZEN ONTO THE ORDER, not looked up from the customer at
-- billing time. Same rule as price_per_lb_cents: changing what an option costs
-- must never re-price work already quoted, and a customer who switches
-- preference after collection must not change what they are charged for a bag
-- already on a scale.
-- ---------------------------------------------------------------------------

-- --- Numbered stickers ------------------------------------------------------

-- Which of the four stickers this row is. NULL means the intake bag itself -
-- the tag as a whole, before anything was peeled off it.
alter table bag_labels add column if not exists sticker_seq smallint
  check (sticker_seq is null or sticker_seq between 1 and 4);

-- The intake bag an output bag came out of. Null on an intake bag.
--
-- This is what lets one bag in become four out and still be traceable: every
-- output row points back at the bag whose contents it holds, so "is this wash
-- all here" is a question about one parent and its children.
alter table bag_labels add column if not exists parent_id uuid
  references bag_labels (id) on delete cascade;

create index if not exists bag_labels_parent_idx on bag_labels (parent_id);

-- A sticker can only be used once per bag tag.
create unique index if not exists bag_labels_parent_seq_idx
  on bag_labels (parent_id, sticker_seq)
  where parent_id is not null and sticker_seq is not null;

-- --- Paid wash options ------------------------------------------------------

-- What the chosen options add, in whole cents, fixed when the order is taken.
alter table orders add column if not exists surcharge_cents integer not null default 0
  check (surcharge_cents >= 0);

comment on column bag_labels.sticker_seq is
  'Which of the four peelable stickers on the bag tag this row is, 1 to 4. '
  'NULL means the intake bag itself. All four stickers print the same bag tag '
  'id; the sequence is what makes them individually addressable, so a repeat '
  'scan is not mistaken for another bag.';

comment on column bag_labels.parent_id is
  'The intake bag this output bag came out of. One bag in becomes any number '
  'of bags out, and this is what ties them back together.';

comment on column orders.surcharge_cents is
  'What the chosen wash options add, frozen when the order is taken. Never '
  'read from the customer at billing time - changing what an option costs must '
  'not re-price work already quoted.';
