-- ---------------------------------------------------------------------------
-- 0047 — the driver confirms the bags are actually in the van.
--
-- NEIL'S PICKUP SEQUENCE, and this is its last step. He wants the order page to
-- show ONE thing at a time and refuse to show the next until the one before it
-- is done:
--
--   1. Collect the bags          -> collected_at, and the order becomes IN_PROCESS
--   2. Tag each bag and scan it  -> a bag_labels row per bag
--   3. Weigh each bag            -> bag_labels.weight_lb, plus a scale photo
--   4. Clips on, bags in the van -> THIS
--
-- WHY STEP 4 NEEDS A COLUMN AT ALL. Every other step in that list is already
-- readable off something: the order has a collected_at, a bag has a label, a
-- label has a weight and a clip. Step 4 is the only one with nothing behind it,
-- because the thing it records is not a consequence of anything the system did
-- - it is the driver saying "they are physically in the van now".
--
-- AND IT IS WORTH RECORDING RATHER THAN ASSUMING. Clips are handed out when a
-- bag is weighed, so without this the sequence would treat "the last bag has a
-- weight" as "everything is loaded". Those are not the same, and the gap
-- between them is exactly where a bag gets left on a porch - which is the one
-- failure this whole step exists to catch.
--
-- Nullable, because every order that already exists was collected under the old
-- flow and nobody is going to go back and confirm a van from three weeks ago.
-- The sequence treats a collected order with bags already weighed as finished
-- with, so no old order gets stuck asking for something nobody can give it.
-- ---------------------------------------------------------------------------

alter table orders add column if not exists van_confirmed_at timestamptz;

comment on column orders.van_confirmed_at is
  'When the driver confirmed the bags were in the van with their clips on - '
  'the last step of the pickup sequence. Not derivable from anything else: '
  'clips are assigned at weighing, so "the last bag has a weight" is not the '
  'same as "everything is loaded", and the gap between them is where a bag '
  'gets left on a porch.';
