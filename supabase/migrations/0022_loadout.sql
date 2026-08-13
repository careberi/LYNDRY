-- The load-out pass: turning a pile of bags in a van into a sequence.
--
-- The driver scans every bag as he loads it at the laundromat. That is one
-- continuous pass, not a search - he is touching each bag anyway. As he scans,
-- three things happen: the bag is recorded as having left the partner, the
-- round is built from everything scanned, and each bag comes back with a stop
-- number he writes on a reusable tag.
--
-- Then he loads in REVERSE. Stop 12 goes in deepest, stop 1 by the door, so
-- every bag is at the tailgate when he needs it. That is the whole trick, and
-- it is what makes numbered tags work instead of requiring somebody to climb
-- over stop 9 to reach stop 2.
--
-- At the door he scans again - to CONFIRM, not to find. He grabs the bag marked
-- 4, scans it, and either gets the delivery screen or a red WRONG BAG. That is
-- the net that catches a mis-clipped tag before it becomes a wrong-address
-- delivery, which is the expensive failure: two customers with each other's
-- underwear and a second round trip.

-- Where a customer actually is, so a round can be put in a sensible order.
--
-- Looked up once from their address and kept, because the address does not
-- move and the geocoder we use is a free public service that asks not to be
-- hammered. Null means it has not been looked up yet or could not be found -
-- either way the round still works, that stop just sorts last.
alter table customers
  add column if not exists lat            numeric(9,6),
  add column if not exists lng            numeric(9,6),
  add column if not exists geocoded_at    timestamptz,
  add column if not exists geocode_failed boolean not null default false;

comment on column customers.lat is
  'Latitude of their address, looked up once and cached. Null if never looked '
  'up or not found; a stop with no coordinates still gets delivered, it just '
  'sorts to the end of the round.';
comment on column customers.geocode_failed is
  'True when the lookup ran and found nothing, so we do not ask again every '
  'time the round is built.';

-- Where this order sits in today's delivery run, and when it was loaded.
--
-- Both are cleared when the order is delivered: a stop number is a fact about
-- one afternoon, not about the order, and leaving yesterday's numbers lying
-- around is how a driver ends up trusting a stale tag.
alter table orders
  add column if not exists stop_number integer,
  add column if not exists loaded_at   timestamptz;

comment on column orders.stop_number is
  'Position in today delivery run, written on the tag clipped to the bag. '
  'Cleared on delivery - it describes one afternoon, not the order.';
comment on column orders.loaded_at is
  'When the driver scanned this order out of the laundromat. The chain of '
  'custody proof that the bag left the partner with us.';

-- Which individual bags have been scanned at the door, so a three-bag order
-- cannot be completed having handed over two.
alter table bag_labels
  add column if not exists loaded_at    timestamptz,
  add column if not exists delivered_at timestamptz;

comment on column bag_labels.loaded_at is
  'When this specific bag was scanned into the van at the laundromat.';
comment on column bag_labels.delivered_at is
  'When this specific bag was scanned at the customer door. Delivery is '
  'refused until every bag on the order has one.';
