-- ---------------------------------------------------------------------------
-- 0093 - a booking intent: what somebody chose, before there is an order
-- ---------------------------------------------------------------------------
--
-- Neil's decision lock, 14 September: for online bookings, no payment method
-- means no order, while the booking intent preserves everything the customer
-- has already entered.
--
-- THIS REVERSES A RULE CLAUDE.md RECORDED AS DELIBERATE, and the reversal is
-- deliberate too. The old rule was "record the pickup first, ask for the card
-- second", written after a real customer was sent away to pay before their
-- booking existed and came back to nothing. Neil's reading, and it is the
-- right one: the problem then was not the ordering, it was that there was no
-- state to come back TO. An order was created early because an order was the
-- only thing that could remember anything. This table is that missing state,
-- so the order no longer has to stand in for it.
--
-- WHAT IT HOLDS IS ONLY WHAT HAS NO OTHER HOME. The wash preferences and the
-- address are already written to the customer row at the address step of the
-- wizard, because that is the step where a guest becomes a customer and where
-- their consent is recorded. So those survive a trip to Stripe today and are
-- deliberately NOT copied here - a second copy of a fact the database already
-- holds is the thing this codebase refuses everywhere else. What is left is
-- the pickup they asked for and the repeat they chose, both of which live on
-- the order and the schedule, neither of which exists yet.
--
-- THE REPEAT IS HELD HERE RATHER THAN CREATED. The wizard used to create the
-- standing order first, because the schedule is what decides the first
-- pickup's date. Creating one before the card would leave somebody with a
-- weekly arrangement they never finished setting up - the same mistake as the
-- early order, one table along. The schedule is made at conversion.
--
-- NO STATUS COLUMN. Open is completed_at is null; finished is order_id set;
-- abandoned is open and old, which is a question about the clock and is asked
-- when it is needed. A stored status would be a third copy of two timestamps.
--
-- ONE OPEN INTENT PER CUSTOMER. Somebody who goes back and changes their mind
-- is still arranging one pickup, so the second attempt replaces the first
-- rather than leaving a trail of half-finished ones for ops to read through.
-- ---------------------------------------------------------------------------

create table if not exists booking_intents (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id) on delete cascade,

  -- What they asked for. Nullable time, exactly as orders.pickup_time is:
  -- "tomorrow" with no time is a real answer and must not be invented into one.
  pickup_date   date,
  pickup_time   time,
  notes         text,

  -- The repeat they chose, carried the way the wizard carries it: a cadence
  -- and a comma-separated list of weekday numbers. Empty cadence is a one-off.
  cadence       text,
  weekdays      text,

  -- What it became. Both null while it is still open.
  order_id      uuid references orders(id) on delete set null,
  completed_at  timestamptz,

  -- SOMEBODY IS TURNING THIS INTO AN ORDER RIGHT NOW.
  --
  -- The webhook and the return page race on every card save - Stripe redirects
  -- the browser the instant the card is saved and the webhook lands seconds
  -- behind - and payment_links.completed_at does not close that window on its
  -- own, because both callers can read the link before either has stamped it.
  --
  -- Without this, both would pass openFor(), both would call bookPickup(), and
  -- the customer would get TWO pickups and two confirmation texts. completed_at
  -- cannot do this job: it is stamped after the order exists, which is exactly
  -- too late, and stamping it early would close an intent whose booking then
  -- got refused and which has to stay resumable.
  --
  -- A CLAIM GOES STALE. If the process holding it dies between claiming and
  -- finishing, an intent that could never be claimed again would be a customer
  -- who can never book. See CLAIM_STALE_SECONDS in booking-intents.js.
  claimed_at    timestamptz,

  -- ONE ABANDONED-CHECKOUT CHASE, EVER. The same column orders carries and for
  -- the same reason: it makes a second text impossible rather than discouraged.
  -- Before booking intents this chase hung off the order that used to be
  -- written early, so moving the order also moved where the chase has to look.
  card_link_sent_at timestamptz,

  -- Why it is still open, when we know. Set when the card is saved but the
  -- pickup they chose is no longer bookable, so ops and the customer's own
  -- page can say which of the two happened rather than "unfinished".
  blocked_reason text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One open intent per customer. Partial, so finished ones accumulate freely -
-- they are the record of what was arranged and when.
create unique index if not exists booking_intents_one_open
  on booking_intents (customer_id)
  where completed_at is null;

create index if not exists booking_intents_open_by_age
  on booking_intents (created_at desc)
  where completed_at is null;

-- Row level security on with no policies, like every other table here: the
-- public anon key gets nothing and the server's service_role key bypasses it.
alter table booking_intents enable row level security;

comment on table booking_intents is
  'What an online customer chose before they had a payment method. Becomes an '
  'order only once a card is saved AND the booking rules still allow it.';

comment on column booking_intents.blocked_reason is
  'Set when a card was saved but the chosen pickup was refused on re-check - '
  'the time had passed, or another booking rule now says no. The card stays '
  'saved; the customer is asked to pick another time.';
