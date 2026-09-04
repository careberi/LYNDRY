-- THE DOORSTEP IS PER BAG, THE WAY THE LAUNDROMAT PICKUP IS.
--
-- Neil's flow: the delivery card lists the van clips, tapping one opens that bag
-- on its own, and there he takes the laundromat's own stickers off, takes our
-- bag tag off, and takes the van clip off - then back to the list for the next.
--
-- "Take the bag tags off" was a single order-level tick for the whole load, so a
-- three-bag order was one tap and nobody could say which bag had been stripped.
-- These two say it per bag; the van clip already had unclipped_at.
--
-- stickers_off_at  the laundromat's own ticket is off this bag
-- tag_off_at       our bag tag, the one with the QR, is off this bag
--
-- SEPARATE FROM released_at, which retires the sticker for good when the order
-- is delivered and is what stops /o/<code> resolving. A tag can be off the bag
-- and still be the record of which bag it was.
alter table bag_labels
  add column if not exists stickers_off_at timestamptz,
  add column if not exists tag_off_at timestamptz;

comment on column bag_labels.stickers_off_at is
  'The laundromat''s own in-house ticket has been taken off this bag, at the door.';
comment on column bag_labels.tag_off_at is
  'Our bag tag has been taken off this bag, at the door. Not the same as released_at.';
