-- A PHOTO OF WHERE THE BAG SITS, KEPT ON THE CUSTOMER.
--
-- Neil's ask, 16 September: one still photo of the spot, taken with the phone
-- camera, so the next driver knows which door.
--
-- ON THE CUSTOMER, NOT THE ORDER, and that is the whole point of it. A delivery
-- photo is evidence about one drop-off and belongs to that order for ever. This
-- answers "which door, which side, behind which planter" - a fact about the
-- ADDRESS, true of every pickup they will ever have. Hung off an order it would
-- be taken again every week and the one a new driver needs would be on a row
-- nobody is looking at.
--
-- A customer has one address in this schema, so customer-level IS
-- address-level. If a customer ever gets a second address this column moves
-- with it rather than being copied.
--
-- IT IS NEVER SENT TO THE CUSTOMER. There is no public link, no /p/<uuid> page
-- and no 30-day window like the delivery photo has. It is signed for a minute
-- at a time, off an ops route, for somebody already signed in. The customer
-- knows where their own door is; this is for us.

alter table customers
  add column if not exists pickup_spot_photo_path text,
  add column if not exists pickup_spot_photo_at timestamptz;

comment on column customers.pickup_spot_photo_path is
  'Path in the private spot-photos bucket of the most recent photo of where '
  'this customer leaves their bag. One per customer, replaced rather than '
  'appended - the current answer to "which door", not a history. Never shown '
  'to the customer and never texted.';

comment on column customers.pickup_spot_photo_at is
  'When that photo was taken, so a driver can see at a glance whether it is '
  'from this season. Null together with the path.';

-- TWO THINGS THIS MIGRATION CANNOT DO, and both have to happen before the code
-- that reads them is merged:
--
--   1. THE BUCKET. `spot-photos`, PRIVATE, alongside delivery-photos and
--      weight-photos. Storage buckets are not schema and do not belong in a
--      SQL migration; make it in the Supabase dashboard under Storage, or with
--      the service-role key:
--
--        await db.storage.createBucket('spot-photos', { public: false });
--
--      Private matters. A public bucket would put every customer's doorstep on
--      a guessable URL, which is the one thing this feature must not become.
--
--   2. NOTHING ELSE. No backfill, no default: every existing customer has no
--      photo, which is the honest state, and the run simply does not draw the
--      card until somebody takes one.
