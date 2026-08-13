-- ---------------------------------------------------------------------------
-- 0038 — bags in is not bags out. The order is the identity; weight is the proof.
--
-- The system assumed one physical bag made the whole round trip: one sticker,
-- bound at the customer's door, weighed there, handed to the laundromat, and
-- then scanned back into the van and scanned again at the door on delivery.
--
-- That is not what happens. A customer's laundry arrives in whatever they own -
-- a trash bag, an IKEA bag, a duffel - and the laundromat washes the CONTENTS
-- and packs them into their own bags. Two bags in can come back as one. One bag
-- in can come back as two.
--
-- Three things broke on that assumption:
--
--   bind()            refused a sticker past orders.bag_count, so a third
--                     returning bag could not be labelled at all.
--   scanIn()          expected the codes from the dirty bags, which no longer
--                     exist as separate objects.
--   allBagsScanned()  required every label on the order to be scanned before
--                     the delivery camera appeared. Three bags consolidated
--                     into one left two labels that could never be scanned,
--                     and the order became UNDELIVERABLE at the doorstep.
--
-- So a label now belongs to a LEG. Pickup labels are bound at the customer's
-- door and their job ends when the bag is handed over; delivery labels are
-- bound at the laundromat when the driver collects the finished work. The two
-- sets are independent and their counts have nothing to do with each other.
--
-- WHAT TIES THEM TOGETHER IS THE ORDER NUMBER, AND WHAT PROVES NOTHING WAS
-- LOST IS THE WEIGHT. Neil's framing and it is the right one: 25 lb collected
-- and 25 lb returned means everything is there, whatever it was carried in.
-- Counting bags across the two legs proves nothing at all.
--
-- return_weight_lb is a CHECK, NEVER A PRICE. Same rule as partner_weight_lb:
-- the pickup scale bills, because that is the number the customer was texted
-- and agreed to. A returning weight that disagrees raises an issue for a
-- person; it must never quietly re-price work already quoted.
-- ---------------------------------------------------------------------------

-- Which leg of the journey this label belongs to.
--
-- Defaults to PICKUP so every label already in the table keeps its meaning:
-- they were all bound at a customer's door, which is what PICKUP means.
alter table bag_labels add column if not exists leg text not null default 'PICKUP';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bag_labels_leg_check'
  ) then
    alter table bag_labels
      add constraint bag_labels_leg_check check (leg in ('PICKUP', 'DELIVERY'));
  end if;
end $$;

-- How many bags are going BACK. Nullable, and null is a real state rather than
-- a gap to tidy away: nobody knows the number until the driver is standing at
-- the laundromat counter looking at the finished work. It is never derived from
-- bag_count, which is the whole point of this migration.
alter table orders add column if not exists return_bag_count smallint
  check (return_bag_count is null or return_bag_count between 1 and 40);

-- The sum of the delivery bags' weights, written only once every returning bag
-- has been weighed - exactly like partner_weight_lb, and for the same reason. A
-- half-weighed return compared against a full collection reads as a missing bag
-- every single time.
alter table orders add column if not exists return_weight_lb numeric(6, 2)
  check (return_weight_lb is null or return_weight_lb >= 0);

-- THE OLD UNIQUE INDEX HAD TO GO, and this is the part that is easy to miss.
--
-- bag_labels_order_position_idx was unique on (order_id, position), which was
-- exactly right while an order had one set of bags. It now rejects the first
-- returning bag on every single order, because delivery bag 1 collides with
-- pickup bag 1. Adding the leg column without this is a migration that looks
-- applied and breaks the first time a driver labels a bag at a laundromat.
--
-- Replaced with the same guarantee scoped to the leg: positions are still
-- unique and gap-free WITHIN a leg, which is what "bag 2 of 3" depends on.
drop index if exists bag_labels_order_position_idx;

create unique index if not exists bag_labels_order_leg_position_idx
  on bag_labels (order_id, leg, position)
  where order_id is not null;

comment on column bag_labels.leg is
  'PICKUP = bound at the customer''s door, weighed there, priced from. '
  'DELIVERY = bound at the laundromat when the finished work is collected, and '
  'scanned at the door. THE TWO COUNTS ARE UNRELATED - the laundromat repacks '
  'into its own bags. Anything asking "are all the bags here" on delivery must '
  'ask about DELIVERY labels only.';

comment on column orders.return_bag_count is
  'How many bags came back from the laundromat. Null until the driver counts '
  'them there. NEVER equal to bag_count by assumption.';

comment on column orders.return_weight_lb is
  'Sum of the delivery bags. Compared against weight_lb to prove nothing was '
  'lost. NEVER prices anything - the pickup scale is what billed the customer.';
