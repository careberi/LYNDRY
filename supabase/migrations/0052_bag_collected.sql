-- ---------------------------------------------------------------------------
-- 0052 — the driver ticks off each finished bag as he picks it up.
--
-- NEIL'S CHANGE to the collect-from-the-laundromat stop. It asked for a weight
-- per ORDER, which is the wrong unit for what is physically happening: the
-- driver is standing at a counter being handed bags one at a time, and the
-- bags on that counter belong to whichever orders they belong to. He does not
-- sort them into orders as he goes and he should not have to.
--
-- So the stop lists every sticker waiting at that laundromat, whoever it
-- belongs to, and he taps each one as it comes into his hands - exactly the
-- way the attendant taps them as they pack them. Not collected yet, then
-- collected. When they are all ticked he moves on.
--
-- WHY A COLUMN AND NOT A COUNT. "Six bags collected" cannot answer which six.
-- If the laundromat has eight on the shelf and the driver takes six, the two
-- left behind are the whole question, and a number cannot name them. A
-- timestamp per bag can, and it is the same shape as finished_at beside it.
--
-- THE WEIGHING DOES NOT GO AWAY. It moves after this rather than being
-- interleaved with it: collect everything, then weigh the load, then the check
-- against what we collected from the customer, and only then the clips. That
-- is Neil's original sequence - weigh, check, then clip - with the gathering
-- separated out in front of it, which is what he is doing anyway.
-- ---------------------------------------------------------------------------

alter table bag_labels add column if not exists collected_at timestamptz;

comment on column bag_labels.collected_at is
  'When the driver took this finished bag off the laundromat''s shelf. Ticked '
  'per bag rather than per order because that is how they are handed over - '
  'and because "six collected" cannot say which six, while the two left behind '
  'are the entire question.';
