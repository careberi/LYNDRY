-- ---------------------------------------------------------------------------
-- 0043 — one tag per ORDER, not one code per bag.
--
-- NEIL'S CALL, and it is a better model than the one it replaces.
--
-- Every bag used to carry its own unique pre-printed code. That was solving a
-- problem nobody had: the wash instructions are per ORDER, so a per-bag code
-- told the laundromat nothing a per-order code would not have. What it did do
-- was make the return leg hard, because a bag the laundromat packed had no code
-- and had to be bound to the order by somebody before it could be tracked.
--
-- Under one shared tag that difficulty disappears. Three bags in and four bags
-- out all read #1042, because the tag is the ORDER and the order did not
-- change. Nothing has to be bound at a counter.
--
-- WHAT VERIFIES A HANDOVER IS WEIGHT, NOT IDENTITY. Neil's framing throughout:
-- the count of bags is a thing to know, but 25 lb collected and 25 lb returned
-- is what proves nothing was lost, whatever it was carried in.
--
-- So the order now holds:
--
--   tag_code            the one identifier, on every bag of the order
--   bag_count           how many came in
--   return_bag_count    how many went back out - unrelated to bag_count
--   weight_lb           our scale at the door, the sum of the bags
--   partner_weight_lb   the laundromat's scale on the same dirty load
--   return_weight_lb    what came back off their shelf
--
-- THE TAG IS RANDOM, NOT THE ORDER NUMBER. order_number is sequential and is
-- for saying out loud; a sequential value in a URL lets anybody who has one
-- read the next order's wash instructions by adding one to it. The tag is drawn
-- from the same 32^6 space as the old bag codes and is signed the same way.
--
-- HOW A STICKER PHYSICALLY CARRIES THE SAME CODE ONTO FOUR BAGS IS NOT SETTLED
-- and is deliberately not decided here. Sheets of identical stickers, a printer
-- in the van and asking the laundromat to return the order as one bundle are
-- all still open. None of them change this table.
-- ---------------------------------------------------------------------------

alter table orders add column if not exists tag_code text;

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'orders_tag_code_key') then
    create unique index orders_tag_code_key on orders (tag_code) where tag_code is not null;
  end if;
end $$;

-- A BAG NO LONGER NEEDS A CODE OF ITS OWN.
--
-- bag_labels keeps its job as the per-bag record - which bag, what it weighed,
-- the photo of the scale, what the laundromat made it - but the code on it
-- becomes optional, because under the order tag a bag is identified by the
-- order it belongs to and its position in it.
--
-- Rows that still have a code are the pre-printed stickers from the old model.
-- They keep working; nothing is dropped and no sticker already stuck to
-- anything stops resolving.
alter table bag_labels alter column code drop not null;

comment on column orders.tag_code is
  'The ONE identifier for this order, carried by every bag of it - the three '
  'that came in and the four that went back out. Random rather than the '
  'sequential order_number, because a sequential code in a URL reads the next '
  'order by adding one. Null until a tag is claimed.';

comment on column bag_labels.code is
  'Optional. Under the order tag a bag is identified by its order and its '
  'position, not by a code of its own. A row WITH a code is a pre-printed '
  'sticker from the per-bag model, which still resolves.';
