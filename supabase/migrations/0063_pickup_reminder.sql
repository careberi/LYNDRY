-- ---------------------------------------------------------------------------
-- 0063 — the day-before reminder.
--
-- Neil's ask: somebody who books a pickup two days out should be reminded the
-- day before, so the bag is actually outside when the van arrives. A booking
-- confirmation sent on Saturday for a Tuesday pickup is not a reminder - by
-- Monday night it is four messages up the thread.
--
-- WHY A COLUMN RATHER THAN WORKING IT OUT. Almost everything else in this
-- system is derived, and deliberately so. This cannot be: "did we already tell
-- them" is a fact about something we DID, not something that can be read back
-- off the order. The nearest derivation would be searching the messages table
-- for a sentence that looks like a reminder, which breaks the first time the
-- wording changes.
--
-- IT IS WHAT MAKES THE NIGHTLY PASS SAFE TO RUN TWICE. Railway retries, and a
-- reminder sent twice is worse than most double-sends because it reads as a
-- system that does not know what it has said. Every other part of that pass is
-- already idempotent - bookPickup() refuses a second pickup for anybody who has
-- one waiting - and this is the same guarantee for the texting half.
--
-- STANDING ORDERS STAMP IT TOO. They already get a day-before text with the
-- SKIP line in it, sent as they are booked, so recurring.bookDue() sets this at
-- the same moment. Without that a standing order would get two reminders on the
-- same evening: theirs, and then this one.
-- ---------------------------------------------------------------------------

alter table orders
  add column if not exists reminder_sent_at timestamptz;

comment on column orders.reminder_sent_at is
  'When the customer was reminded that this pickup is tomorrow. Null means '
  'they have not been. Set by reminders.sendDue() and by recurring.bookDue(), '
  'whose SKIP message is itself the day-before reminder. Exists so the nightly '
  'pass is safe to run more than once.';
