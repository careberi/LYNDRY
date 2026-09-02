-- ---------------------------------------------------------------------------
-- WHERE THE VAN LIVES, AS AN ADDRESS SOMEBODY TYPED.
--
-- The service base was a pair of coordinates frozen into src/core/geocode.js -
-- 40.9404, -74.1182 - with no street address attached to it and nobody's name
-- on the decision. Neil looked at the routing board and said, correctly, that
-- the base "is not associated with me".
--
-- It matters more than it looks. Every round is measured from it, every
-- driver with no base of their own falls back to it, and the nearest-driver
-- assignment compares against it. A base in the wrong place is a route that is
-- wrong from its first mile, and there was no way to correct it without a
-- code change and a deploy.
--
-- So it lives on the one app_settings row, beside the closed sign and the
-- weight thresholds - the other two things about how the business runs that an
-- owner has to be able to change at half past six in the morning.
--
-- THE COORDINATES ARE CACHED, NOT TYPED. Somebody enters a street address; the
-- same rate-limited public geocoder that places a customer and a laundromat
-- places this, once, and the answer is kept. base_geocode_failed records a
-- lookup that came back empty so it is visible on the page rather than being
-- retried on every page load.
--
-- Every column is nullable and the fallback stays in code, so a database that
-- has never had a base set behaves exactly as it did before this migration.
-- ---------------------------------------------------------------------------

alter table app_settings add column if not exists base_address_line1 text;
alter table app_settings add column if not exists base_city           text;
alter table app_settings add column if not exists base_state          text;
alter table app_settings add column if not exists base_postal_code    text;

alter table app_settings add column if not exists base_lat numeric(9,6);
alter table app_settings add column if not exists base_lng numeric(9,6);

alter table app_settings add column if not exists base_geocoded_at     timestamptz;
alter table app_settings add column if not exists base_geocode_failed  boolean not null default false;

comment on column app_settings.base_address_line1 is
  'Where the van starts and ends the day. Blank falls back to the constant in '
  'src/core/geocode.js, which is what every route used before this existed.';

comment on column app_settings.base_lat is
  'Cached from the geocoder, never typed by hand. Cleared whenever the address '
  'changes so it cannot point at the previous building.';
