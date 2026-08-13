-- Partners: the businesses we actually work with.
--
-- NOT the same thing as `partner_enquiries`, which is the website form and is
-- a pile of strangers who filled something in. This is the short list of places
-- we have a relationship with, entered by hand by Neil, and it is the record
-- the business runs on rather than a lead list.
--
-- Two kinds, because they are two entirely different relationships:
--
--   LAUNDROMAT        somewhere we pay to wash bags. Has a wholesale rate, a
--                     capacity, and opening hours, because all three decide
--                     whether a bag can go there today.
--   PROPERTY_MANAGER  a building or a landlord who sends us customers. None of
--                     those columns mean anything for them and they stay null.
--
-- The laundromat columns are deliberately nullable rather than split into a
-- second table. There will be a handful of these, not thousands, and one table
-- somebody can read top to bottom beats a join that has to be explained.

create table if not exists partners (
  id            uuid primary key default gen_random_uuid(),

  type          text not null,
  name          text not null,
  status        text not null default 'ACTIVE',

  -- Where it is. Geocoded the same way a customer is, and for the same reason:
  -- a laundromat is a stop on a round, so it needs to be a point on a map.
  address_line1 text,
  address_line2 text,
  city          text,
  state         text,
  postal_code   text,
  lat            numeric(9,6),
  lng            numeric(9,6),
  geocoded_at    timestamptz,
  geocode_failed boolean not null default false,

  -- Who to ring.
  contact_name  text,
  phone         text,
  email         text,

  -- LAUNDROMAT ONLY --------------------------------------------------------

  -- Free text, on purpose. "Mon-Fri 7am-9pm, Sat 8-6, closed Sunday" is what a
  -- person writes and what a person reads, and nothing in the system decides
  -- anything from it yet. The day something needs to answer "are they open
  -- now", that is the day to structure it - inventing seven open/close pairs
  -- today would be a form nobody wants to fill in for information nothing uses.
  hours text,

  -- Whole cents, never decimals, like every other money column here.
  --
  -- Retail is what they charge a walk-in. It is not what we pay, and nothing
  -- computes from it - it is here because knowing a laundromat charges $1.75
  -- retail while quoting us $1.10 wholesale is the whole of a negotiation.
  retail_per_lb_cents    integer,
  wholesale_per_lb_cents integer,

  -- How much they can actually take in a day. The number that decides whether
  -- a heavy round can go to one place or has to be split.
  daily_capacity_lb integer,

  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint partners_type_check
    check (type in ('LAUNDROMAT', 'PROPERTY_MANAGER')),

  -- Text with a CHECK, never a Postgres enum, so adding a third kind later is
  -- a one-line change rather than a migration nobody wants to run.
  constraint partners_status_check
    check (status in ('ACTIVE', 'PAUSED', 'ENDED')),

  constraint partners_money_check
    check (
      (retail_per_lb_cents is null or retail_per_lb_cents >= 0) and
      (wholesale_per_lb_cents is null or wholesale_per_lb_cents >= 0) and
      (daily_capacity_lb is null or daily_capacity_lb > 0)
    )
);

alter table partners enable row level security;

create index if not exists partners_type_status_idx on partners (type, status);

comment on table partners is
  'Businesses we work with, entered by hand. Distinct from partner_enquiries, '
  'which is the website form and is a lead list.';
comment on column partners.retail_per_lb_cents is
  'What they charge a walk-in. Nothing computes from it; it is here because '
  'the gap between their retail and our wholesale is the negotiation.';
comment on column partners.hours is
  'Free text on purpose. Nothing decides anything from it yet, and a form of '
  'seven open/close pairs is one nobody fills in.';

-- WHICH laundromat had this bag.
--
-- Without it there is no way to answer "is one partner consistently heavier
-- than our scale", which is the entire point of recording their weight. The
-- discrepancy history IS this column joined to the weights already on the
-- order - no second table, because orders are already the record and a copy
-- would only be something else to keep in step.
alter table orders
  add column if not exists partner_id uuid references partners(id) on delete set null;

create index if not exists orders_partner_idx on orders (partner_id);

comment on column orders.partner_id is
  'The laundromat this bag was dropped at, chosen by the driver. Null for a '
  'bag we washed ourselves. Joined to weight_lb and partner_weight_lb, this is '
  'the whole scale-discrepancy history.';
