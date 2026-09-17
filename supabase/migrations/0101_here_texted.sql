-- HAVE WE TOLD THEM THE VAN IS OUTSIDE?
--
-- Neil, 17 September: "On the driver's first stop, scanning the pickup location
-- is its own screen. After that scan, or after I tap I'm here after directions,
-- send the customer the 'we're here for your laundry' text. One text. Not on
-- every bag."
--
-- WHERE THAT TEXT USED TO COME FROM. fulfilment.collect() sent it as part of
-- moving the order to IN_PROCESS, and the thing that moves an order to
-- IN_PROCESS is binding the FIRST BAG TAG. So the customer heard "we're here"
-- when the driver had already walked up, found the bags and scanned one of
-- them - on order #2070 that was 11:46:19, a minute and nine seconds after the
-- "we're on our way" text, and after the driver was standing at the door.
--
-- It only ever went once, because the state machine refuses a second move to
-- IN_PROCESS. What was wrong was WHEN.
--
-- WHY THIS IS STORED RATHER THAN DERIVED. It is the same argument CLAUDE.md
-- already makes for orders.reminder_sent_at: "did we already tell them" is a
-- fact about something we DID, and the nearest derivation is searching
-- `messages` for a sentence that looks like the one we send, which breaks the
-- first time the wording changes.
--
-- It cannot be read off arrived_at either, which is the obvious candidate and
-- the wrong one: that column is a flag rather than history, it is cleared by
-- anything that completes a stop, and one order is arrived at several times in
-- its life - the door to collect, the laundromat to drop, the door again to
-- deliver.
--
-- IT ALSO SAYS THE DRIVER HAS DONE THE LOCATION STEP, and that is one fact
-- rather than two: he taps the screen, the customer is told, and both halves
-- happen in the same breath. The run reads it to know that first screen is
-- behind him, which is why it must not be a column anything clears.
--
-- STAMPED AFTER THE ATTEMPT, whether or not the carrier took it. An opted-out
-- number is refused by notify.sendAndLog() and that refusal must not leave a
-- driver stuck on a screen he cannot get past - the text is for the customer,
-- the step is for him, and the one failing is not a reason to stop the other.

alter table orders
  add column if not exists here_texted_at timestamptz;

comment on column orders.here_texted_at is
  'When the customer was told we are outside for the pickup, and therefore also '
  'when the driver completed the location step. One per order, never cleared - '
  'a rollback that wants the text sent again has to null it deliberately. NOT '
  'arrived_at, which is a flag that gets cleared and covers three different '
  'arrivals in one order life.';
