-- ---------------------------------------------------------------------------
-- 0035 — a wage per person, not one number for everybody.
--
-- The margin was built on config.routing.wagePerHour, a single figure for the
-- whole business. Two drivers are rarely paid the same, and the margin on a
-- round is only worth reading if it uses what THAT round actually costs.
--
-- Null means "use the configured default", which is what every existing row
-- means today. Nothing has to be filled in for the system to keep working, and
-- a business with one pay rate never has to touch it.
-- ---------------------------------------------------------------------------

alter table ops_users add column if not exists wage_cents_hour integer
  check (wage_cents_hour is null or wage_cents_hour > 0);

comment on column ops_users.wage_cents_hour is
  'What this person is paid an hour, in whole cents. Null falls back to '
  'config.routing.wagePerHour. Feeds the margin on the routing board, which '
  'charges every paid minute - driving and standing.';
