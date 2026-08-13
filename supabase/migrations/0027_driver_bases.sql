-- ---------------------------------------------------------------------------
-- 0027 — a driver has a home base, and an order has a driver.
--
-- Until now the system had exactly one driver and never said so out loud. The
-- route started and ended at a single hardcoded point in src/core/geocode.js,
-- and an order knew who had collected it only after the fact, as a name in
-- order_events. Neither survives a second driver: "today's run" is not a thing
-- the business has any more, "this driver's run" is.
--
-- TWO COLUMNS' WORTH OF IDEA.
--
--   A driver works out of somewhere. Fair Lawn is not Maryland, and a route
--   solved from the wrong start is wrong from the first mile.
--
--   An order belongs to one of them. Without that there is no such thing as
--   "where their day stands", because there is no set of stops that is theirs.
-- ---------------------------------------------------------------------------

-- --- where a driver starts and ends the day --------------------------------
--
-- The same shape as a customer's address and a partner's, deliberately, so the
-- one rate-limited geocoder can put all three on the map without a special
-- case per table.
alter table ops_users add column if not exists base_address_line1 text;
alter table ops_users add column if not exists base_address_line2 text;
alter table ops_users add column if not exists base_city          text;
alter table ops_users add column if not exists base_state         text;
alter table ops_users add column if not exists base_postal_code   text;

alter table ops_users add column if not exists base_lat            numeric(9,6);
alter table ops_users add column if not exists base_lng            numeric(9,6);
alter table ops_users add column if not exists base_geocoded_at    timestamptz;
alter table ops_users add column if not exists base_geocode_failed boolean not null default false;

comment on column ops_users.base_address_line1 is
  'Where this person starts and ends the day. Null means they fall back to the '
  'service-wide base in src/core/geocode.js, which is what every route used '
  'before drivers had their own.';

-- --- whose order is it ------------------------------------------------------
--
-- Nullable on purpose, and it is not a gap to be tidied away later. An order
-- with no driver is a real state: nobody has a base set yet, or every driver
-- was disabled, or it arrived before assignment ran. The boards show those
-- explicitly as unassigned rather than hiding them, because an order nobody
-- owns is exactly the one that gets missed.
--
-- ON DELETE SET NULL rather than cascade: a driver row is never actually
-- deleted (they are DISABLED, so the record of who did what survives), but if
-- one ever were, it must not take somebody's laundry order with it.
alter table orders add column if not exists driver_id uuid
  references ops_users (id) on delete set null;

comment on column orders.driver_id is
  'Which driver this order belongs to. Assigned automatically to whichever '
  'active driver has the nearest home base, and reassignable by hand - the '
  'automatic answer knows about distance and nothing about who is off sick.';

-- The board asks "what is this driver doing today" on every page load, which
-- is this index exactly.
create index if not exists orders_driver_date_idx
  on orders (driver_id, pickup_date);

-- Finding orders nobody owns has to stay cheap, because that list is the one
-- worth looking at.
create index if not exists orders_unassigned_idx
  on orders (pickup_date)
  where driver_id is null;
