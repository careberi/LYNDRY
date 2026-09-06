-- ---------------------------------------------------------------------------
-- 0064 — the app runs its own nightly pass.
--
-- THE PROBLEM. Standing orders and the day-before reminders both depend on
-- something running once a night, and that something was a Railway cron
-- service - a second service, configured by hand, in a dashboard, which nobody
-- had actually set up. So the feature was written, tested, deployed, and would
-- have sent nothing at all. Neil asked the obvious question: why does this need
-- a cron job, shouldn't it just happen?
--
-- It should. The web app is already running every minute of every day - it has
-- to be, or an inbound text goes unanswered - so it can watch the clock itself
-- for free. This column is what makes that safe.
--
-- ONE DATE: the last day the pass completed, in New Jersey's calendar. The app
-- polls every few minutes and asks two questions - is it evening, and is this
-- date today. That is a POLL rather than a one-shot timer on purpose: a
-- deploy at 5:59pm restarts the process and a one-shot timer would be lost,
-- while a poll simply asks again a few minutes later.
--
-- STAMPED AFTER THE PASS, NOT BEFORE. A crash halfway through then retries on
-- the next poll instead of being written off, and retrying is safe because
-- every piece of the pass is already idempotent: bookPickup() refuses a second
-- pickup for anybody who has one waiting, and orders.reminder_sent_at stops a
-- reminder going twice.
--
-- THE CRON STILL WORKS IF IT IS EVER SET UP. Both call the same function and
-- both are idempotent, so whichever runs first does the work and the other
-- finds nothing to do. Two doors, one implementation - the rule the rest of
-- this codebase already follows.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists nightly_ran_on date;

comment on column app_settings.nightly_ran_on is
  'The last date the nightly pass completed, in America/New_York. The app '
  'polls in the evening and runs the pass when this is not today. Stamped '
  'after the pass, so a failure retries rather than being written off.';
