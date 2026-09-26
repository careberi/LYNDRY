-- 0103_courier_deliveries.sql
--
-- WHAT A COURIER WAS ASKED TO DO, AND WHAT HAPPENED.
--
-- Neil, 25 September: "in the order screen, there should be a button of the
-- attendant to tell the uber driver to come get the bags." Pressing it books a
-- real delivery at a real vendor, and nothing in this database could record one.
--
-- A TABLE RATHER THAN COLUMNS ON `orders`, AND THAT IS THE WHOLE DESIGN
-- DECISION. An order under the courier model has TWO trips - the customer's door
-- to the laundromat, and the laundromat back to the customer's door - and one
-- `courier_delivery_id` column cannot hold both. Adding a second column beside
-- it would be the leg encoded in a name, which is the shape that goes wrong the
-- first time a trip is retried or a third leg exists.
--
-- IT IS ALSO A LEDGER, NOT A STATUS. A booking that was refused, or cancelled,
-- or replaced after a courier gave up, is a thing that happened and is worth
-- keeping - the same argument `order_events` makes. Nothing here is ever
-- updated except the fields a courier's own webhook moves.

create table if not exists courier_deliveries (
  id uuid primary key default gen_random_uuid(),

  order_id uuid not null references orders (id) on delete cascade,

  -- WHICH TRIP. `TO_PARTNER` is the customer's door to the laundromat;
  -- `TO_CUSTOMER` is the laundromat back to the door. A text column with a CHECK
  -- rather than an enum, the rule this schema follows everywhere, so a third leg
  -- is a one-line change.
  leg text not null,

  -- The courier's own id for it, `del_...` at Uber. Nullable because a booking
  -- can be refused before one exists, and a refusal is worth recording.
  delivery_id text,

  -- Their status, in their words, so nothing here has to be kept in step with a
  -- vendor's vocabulary: pending, pickup, pickup_complete, dropoff, delivered,
  -- canceled, returned.
  status text,

  -- WHAT THE TRIP COST US, in cents, as quoted at the moment it was booked. Not
  -- what the customer paid: that is two legs grossed up for Stripe and was
  -- settled long before this row existed.
  fee_cents integer,

  quote_id text,

  -- THE HANDOVER PIN. Uber generates it, returns it on the dropoff, and texts it
  -- to the recipient. It proves the bags reaching a counter are the bags that
  -- left a doorstep. Nullable: a delivery left at a door has no PIN, because
  -- there is nobody there to read one out.
  pin text,

  tracking_url text,

  -- The photo the courier takes at each end. Uber's own URLs, on their host -
  -- deliberately not copied into our storage yet, because a delivery photo the
  -- CUSTOMER is texted goes through /p/<order-uuid> and that path re-signs from
  -- our own bucket. Whoever wires the customer-facing photo has to decide which.
  pickup_photo_url text,
  dropoff_photo_url text,

  -- WHO ASKED FOR IT. A `partner_users.id` when an attendant pressed the button,
  -- null when a sweep or an ops screen did. It is the answer to "who sent a
  -- courier to my shop at four in the morning", which is exactly the question
  -- somebody asks once.
  --
  -- ON DELETE SET NULL, not cascade: an attendant who leaves must not take the
  -- record of the deliveries they booked with them.
  requested_by uuid references partner_users (id) on delete set null,

  requested_at timestamptz not null default now(),
  updated_at timestamptz,

  -- Why it could not be booked, when it could not. Their code, untranslated:
  -- `address_undeliverable` nearly always means the trip is longer than the ten
  -- routed miles Uber Direct stops at, and never that a town is excluded.
  refused_reason text,

  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'courier_deliveries_leg_check') then
    alter table courier_deliveries add constraint courier_deliveries_leg_check
      check (leg in ('TO_PARTNER', 'TO_CUSTOMER'));
  end if;
end $$;

create index if not exists courier_deliveries_order_idx on courier_deliveries (order_id, leg);

-- A COURIER'S WEBHOOK ARRIVES KNOWING ONLY THEIR OWN ID, so that is the lookup
-- it needs. Partial, because a refused booking has no delivery id and there can
-- be many of those.
create unique index if not exists courier_deliveries_delivery_key
  on courier_deliveries (delivery_id)
  where delivery_id is not null;

-- Row level security on, no policies - the same as every other table here. That
-- denies all access through Supabase's public anon key; the server holds the
-- service_role key, which bypasses RLS entirely.
alter table courier_deliveries enable row level security;
