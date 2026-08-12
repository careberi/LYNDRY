-- Two more places a bag can be.
--
-- Until now the system knew a bag was "IN_PROCESS", which meant everything
-- between the driver picking it up and it going back out. That was true when
-- we imagined doing the washing ourselves. With a partner laundromat doing it,
-- the interesting question is which side of the counter it is on:
--
--   IN_PROCESS   collected, in the van, ours
--   AT_PARTNER   dropped at the laundromat, being washed
--   READY        washed and folded, waiting for the driver to collect it
--
-- Both are optional. IN_PROCESS can still go straight to OUT_FOR_DELIVERY, so
-- an order we handle ourselves does not have to pretend to visit a partner.
--
-- This is exactly why statuses are text with a CHECK constraint rather than a
-- Postgres enum: adding two is this file, not a type migration.

alter table orders
  drop constraint if exists orders_status_check;

alter table orders
  add constraint orders_status_check
  check (status in ('REQUESTED', 'ASSIGNED', 'DEPOSITED', 'IN_PROCESS',
                    'AT_PARTNER', 'READY',
                    'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELED'));

-- When each happened. Not decoration: "the laundromat has had this for two
-- days" is only answerable if the arrival was stamped, and that is the first
-- question when a customer asks where their laundry is.
alter table orders
  add column if not exists at_partner_at timestamptz,
  add column if not exists ready_at      timestamptz;

comment on column orders.at_partner_at is
  'When the driver dropped the bag at the partner laundromat.';
comment on column orders.ready_at is
  'When the partner finished and the bag was ready to be collected again.';
