-- 0059  THE DAY WE OPEN.
--
-- Neil is taking bookings from today and collecting from Tuesday 8 September.
-- Seventeen people signed up through the website while the service was shut,
-- and telling them "come back on Tuesday" wastes the only thing a pre-launch
-- signup list is good for.
--
-- So this is not the closed sign. Closed means nobody can book at all. This
-- means anybody can book, and the earliest day a van will come is the one in
-- this column - the pipeline fills up and the first round has work in it.
--
-- It lives beside taking_orders rather than in an env var for the same reason
-- that one does: it changes what the AI says AND what bookPickup() will do, and
-- Neil has to be able to move it from a screen without a deploy.
--
-- NULL means no restriction, which is the ordinary state once the business is
-- running. A date in the past is harmless and means the same thing.

alter table app_settings add column if not exists opens_on date;

comment on column app_settings.opens_on is
  'The earliest date a pickup may be booked for. Null once we are running - it '
  'exists for a launch, where bookings open before the van does.';
