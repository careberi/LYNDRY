-- ---------------------------------------------------------------------------
-- 0033 — the numbered clip that goes on a bag while it is in the van.
--
-- A sticker code like 7MQ5Y2 identifies a bag perfectly and is useless shouted
-- across a laundromat. What a driver and a counter assistant actually need is a
-- short number: "these three, four, six and ten."
--
-- SO A CLIP IS PHYSICAL STOCK, not a generated number. Neil owns a set of
-- numbered clips; the system hands out the ones that are free and takes them
-- back when the bag is dropped off, exactly the way bag stickers are minted,
-- bound and released. A clip in the wrong column is a clip that is not in the
-- van, which is why it is tracked rather than assumed.
--
-- PER VAN. Each driver has their own set, so Dan's clip 4 and somebody else's
-- clip 4 are two different clips on two different vans and never collide. The
-- driver is on the order, so the clip's owner comes from there rather than
-- being stored twice.
--
-- THE CLIP'S LIFE IS THE VAN LEG: on at the door when the bag is weighed, off
-- when it is handed to the laundromat. It answers "which bags am I handing
-- over" and nothing else. The journey home is already numbered - that is
-- `orders.stop_number`, set by the load-out pass, and the two must not be
-- confused: a stop number says which door, a clip number says which bag.
-- ---------------------------------------------------------------------------

alter table bag_labels add column if not exists clip_number smallint
  check (clip_number is null or clip_number > 0);

alter table bag_labels add column if not exists clipped_at   timestamptz;
alter table bag_labels add column if not exists unclipped_at timestamptz;

comment on column bag_labels.clip_number is
  'The numbered clip on this bag while it is in the van. Freed when the bag is '
  'handed to the laundromat. Scoped to the driver on the order - each van has '
  'its own set of clips.';

comment on column bag_labels.unclipped_at is
  'When the clip came off, which is what makes that number free again. Null '
  'while the clip is still on the bag.';

-- The question asked every time a clip is handed out - "which numbers are in
-- use right now" - and every time a driver reaches a laundromat.
create index if not exists bag_labels_clip_in_use_idx
  on bag_labels (clip_number)
  where clip_number is not null and unclipped_at is null;
