-- THREE PHYSICAL STATES AT A LAUNDROMAT, WHERE THERE WAS ONE.
--
-- Neil's flow: collect the bags out of the van, hand each one to the attendant
-- taking its clip off, then confirm every clip is back in the van. Three cards,
-- three distinct things that are true about a bag, and the last one closes the
-- loop on the clip - a piece of physical stock we own a finite number of.
--
-- unloaded_at      the bag is out of the van and in the driver's hands
-- clip_returned_at the clip is back in the van and free for the next pickup
--
-- WHY clip_returned_at IS NOT unclipped_at. A clip taken off a bag at a counter
-- is in the driver's pocket, not in the van. Until this stamp it is still out,
-- so assignClip() will not hand it to another bag. That is the whole point of
-- the third card: the system knows a clip is available because somebody said
-- so, not because it inferred it from an earlier step.
alter table bag_labels
  add column if not exists unloaded_at timestamptz,
  add column if not exists clip_returned_at timestamptz;

-- EVERY CLIP ALREADY TAKEN OFF IS ALREADY BACK. The old flow had no step
-- between the two, so unclipped meant returned. Without this backfill every
-- clip ever used would read as still out and the pool would empty on day one.
update bag_labels
   set clip_returned_at = unclipped_at
 where unclipped_at is not null
   and clip_returned_at is null;

comment on column bag_labels.unloaded_at is
  'The bag is out of the van at a laundromat, in the driver''s hands. Card 1 of the drop-off.';
comment on column bag_labels.clip_returned_at is
  'The van clip is back in the van and free to be assigned again. Card 3 of the drop-off.';
