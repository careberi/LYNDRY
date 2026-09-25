-- ---------------------------------------------------------------------------
-- THE TWO REMAINING PHOTO BUCKETS, IN THE SCHEMA RECORD AT LAST.
--
-- THIS REVERSES WHAT 0097 SAYS, and the reversal is the point. That file reads:
-- "Storage buckets are not schema and do not belong in a SQL migration; make it
-- in the Supabase dashboard". 0021 had already done the opposite four months
-- earlier, creating `weight-photos` with the insert below - so the repo held
-- both positions at once, and only one of them survives contact with a second
-- database.
--
-- 25 SEPTEMBER, STANDING UP A DEVELOPMENT DATABASE. All 99 migrations applied
-- cleanly and `weight-photos` appeared on its own, because 0021 creates it.
-- `delivery-photos` and `spot-photos` did not, because nothing anywhere creates
-- them - the instruction to do it by hand lives in a comment inside a migration
-- nobody reads while setting up.
--
-- AND A MISSING BUCKET FAILS AT THE WORST POSSIBLE MOMENT. It does not stop the
-- server booting and it raises no warning: the first symptom is a driver
-- standing on a doorstep tapping Delivered, at the end of the run, with the
-- laundry already out of the van.
--
-- PRIVATE, BOTH OF THEM, AND THAT IS NOT A DEFAULT TO RELY ON. A public
-- delivery-photos bucket puts every customer's doorstep on a guessable URL, and
-- a public spot-photos bucket does the same for a photo of where they hide
-- their key. The customer's own link is `lyndry.com/p/<order-uuid>`, which
-- re-signs a one-hour storage URL on every visit precisely so the bucket never
-- has to be public.
--
-- IDEMPOTENT, so this is a no-op against production, where all three buckets
-- have existed since August and September respectively.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('delivery-photos', 'delivery-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('spot-photos', 'spot-photos', false)
on conflict (id) do nothing;
