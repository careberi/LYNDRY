-- 0060  WHAT THEY HAVE ALREADY ASKED FOR.
--
-- "yeah lets do tuesday @ 10:30", then a name and an address, and then the AI
-- asked "when would you like it picked up?". Corrected with "i said 10:30" it
-- apologised, agreed, asked for the wash preferences - and two messages later
-- asked when they wanted it picked up again.
--
-- The thread was in front of it the whole time: ten messages, including the one
-- with the time in it. Reading it was never the problem. Nothing in this system
-- had written the answer down, so the model had to keep re-deriving it from
-- prose, and eventually it did not.
--
-- So it gets written down. check_slot already knows the day and time - it is
-- the function that just checked them - and it stores them here. The prompt
-- states it as a fact, the same way it states the pickup windows and the
-- weekday rather than asking the model to work them out.
--
-- Cleared the moment an order exists, because by then the order IS the record.

alter table customers add column if not exists pending_pickup jsonb;

comment on column customers.pending_pickup is
  'The day and time this customer has asked for but has not yet had booked. '
  'Written when check_slot runs, cleared when the order is created.';
