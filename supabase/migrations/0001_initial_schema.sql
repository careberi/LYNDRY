-- LYNDRY initial schema
--
-- Five tables: buildings, customers, lockers, orders, messages.
--
-- A note on style: statuses are plain text columns with a CHECK constraint
-- listing the allowed values, rather than Postgres ENUM types. Both prevent
-- typos. CHECK constraints were chosen because adding a new status later is a
-- one-line change, whereas altering an ENUM is awkward. This project is early
-- and the statuses will move.

-- ---------------------------------------------------------------------------
-- buildings
--
-- Apartment buildings with LYNDRY lockers. Unused at launch (we are starting
-- with residential home pickup) but the table exists so lockers can be added
-- later without restructuring anything.
-- ---------------------------------------------------------------------------
create table if not exists buildings (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- customers
--
-- phone is the identity of a customer. It is how they are recognised when a
-- text arrives, so it is unique and always stored in +1XXXXXXXXXX form.
--
-- Residential customers have a street address and no building. Building
-- customers have a building_id and unit and no street address. Both are
-- allowed, which is what lets us add buildings later without a migration.
-- ---------------------------------------------------------------------------
create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null unique,
  name            text,
  email           text,

  -- Building customers (unused at launch)
  building_id     uuid references buildings(id) on delete set null,
  unit            text,

  -- Residential customers
  address_line1   text,
  address_line2   text,
  city            text,
  state           text,
  postal_code     text,

  -- Wash preferences, collected once on the website so SMS never has to ask.
  -- Deliberately a flexible JSON blob: we do not yet know every field we need.
  preferences     jsonb not null default '{}'::jsonb,

  -- Legal proof that this customer opted in to being texted. Captured at web
  -- signup. Carriers ask to see this.
  sms_consent_at  timestamptz,
  sms_consent_ip  text,

  status          text not null default 'ACTIVE'
                  check (status in ('ACTIVE', 'UNSUBSCRIBED', 'BLOCKED')),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- lockers
--
-- One physical compartment. controller_id and relay_channel identify which
-- Shelly relay opens it. Unlocking is an event, not a state, so it is not
-- recorded here.
-- ---------------------------------------------------------------------------
create table if not exists lockers (
  id             uuid primary key default gen_random_uuid(),
  building_id    uuid not null references buildings(id) on delete cascade,
  label          text not null,
  controller_id  text,
  relay_channel  integer,
  state          text not null default 'AVAILABLE'
                 check (state in ('AVAILABLE', 'ASSIGNED', 'OCCUPIED', 'OUT_OF_SERVICE')),
  created_at     timestamptz not null default now(),

  -- Two lockers in the same building cannot share a label.
  unique (building_id, label)
);

-- ---------------------------------------------------------------------------
-- orders
--
-- Allowed status flow, enforced in code (src/core/orders.js):
--   REQUESTED -> ASSIGNED -> DEPOSITED -> IN_PROCESS -> OUT_FOR_DELIVERY -> DELIVERED
--
-- ASSIGNED and DEPOSITED are the locker path and unused at launch. Residential
-- orders go REQUESTED -> IN_PROCESS when the driver collects the bag.
--
-- CANCELED is only reachable before the laundry is in our hands.
-- ---------------------------------------------------------------------------
create table if not exists orders (
  id                 uuid primary key default gen_random_uuid(),

  -- on delete restrict: a customer with order history cannot be deleted by
  -- accident. Their orders are business records.
  customer_id        uuid not null references customers(id) on delete restrict,
  locker_id          uuid references lockers(id) on delete set null,

  status             text not null default 'REQUESTED'
                     check (status in ('REQUESTED', 'ASSIGNED', 'DEPOSITED', 'IN_PROCESS',
                                       'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELED')),

  service            text not null default 'WASH_DRY_FOLD'
                     check (service in ('WASH_DRY_FOLD')),

  pickup_date        date not null,

  -- Residential only: does the customer leave the bag out, or hand it over?
  pickup_method      text
                     check (pickup_method in ('LEAVE_OUTSIDE', 'HAND_TO_DRIVER')),

  notes              text,

  -- Money is stored in whole cents, never as a decimal. $39.00 = 3900.
  -- Decimals lose precision in arithmetic; integers do not.
  price_cents        integer not null default 3900 check (price_cents >= 0),

  delivery_photo_url text,

  created_at         timestamptz not null default now(),
  deposited_at       timestamptz,
  collected_at       timestamptz,
  delivered_at       timestamptz
);

-- A customer may only have one order awaiting collection at a time.
--
-- This is what makes "your open order" unambiguous, which matters for
-- security: open_locker() resolves which compartment to open purely from the
-- caller's phone number, so there must be exactly one answer.
--
-- Orders already being washed or delivered are excluded, so a customer can
-- place a new order while a previous one is still in progress.
create unique index if not exists orders_one_open_per_customer
  on orders (customer_id)
  where status in ('REQUESTED', 'ASSIGNED', 'DEPOSITED');

create index if not exists orders_customer_created_idx on orders (customer_id, created_at desc);
create index if not exists orders_pickup_date_idx      on orders (pickup_date, status);
create index if not exists orders_status_idx           on orders (status);

-- ---------------------------------------------------------------------------
-- messages
--
-- Every text in and out.
--
-- provider_message_id is UNIQUE and that is the whole point of it. Carriers
-- retry webhooks; without this constraint the same customer text could be
-- acted on twice, creating two orders. NULL is allowed and repeats freely,
-- which is fine — Postgres does not treat NULLs as equal to each other.
-- ---------------------------------------------------------------------------
create table if not exists messages (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid references customers(id) on delete set null,
  direction           text not null check (direction in ('INBOUND', 'OUTBOUND')),
  body                text not null,
  provider_message_id text unique,
  created_at          timestamptz not null default now()
);

create index if not exists messages_customer_created_idx on messages (customer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Every Supabase project ships with a public "anon" key that is safe to put in
-- a web page. Without RLS switched on, anyone holding that key could read
-- these tables — including customer phone numbers and addresses.
--
-- We turn RLS on and deliberately create no policies, which denies everything.
-- Our server connects with the service_role key, which bypasses RLS entirely,
-- so the app is unaffected. The effect is: only our server can touch this data.
-- ---------------------------------------------------------------------------
alter table buildings enable row level security;
alter table customers enable row level security;
alter table lockers   enable row level security;
alter table orders    enable row level security;
alter table messages  enable row level security;
