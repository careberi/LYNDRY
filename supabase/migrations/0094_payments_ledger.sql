-- ---------------------------------------------------------------------------
-- 0094 - a payments ledger, so part card and part cash can be read later
-- ---------------------------------------------------------------------------
--
-- Neil, 14 September. Cash is NOT a payment method here. A customer cannot
-- choose it, it is not on the checkout, and it is not on the driver's route.
-- It is an admin option in exactly one situation: the card was refused, we are
-- holding the laundry, and money is still owed.
--
-- WHY A LEDGER RATHER THAN A COLUMN. The question "how was this paid" has more
-- than one answer on the same order - $80 on a card, $15 in cash - and a single
-- payment_status can only ever hold one word. dispatch.balance() was written
-- as money rather than as `payment_status === 'FAILED'` in the first place so
-- this could arrive without re-opening the hold rule; this is that arrival.
--
-- THERE IS NO CASH STATUS AND THERE MUST NOT BE. payment_status stays
-- UNPAID / PAID / FAILED / WAIVED. An order settled partly in cash reads PAID
-- because it is paid; HOW it was paid is these rows. A CASH status would say
-- the whole order was cash when only the leftover was, and it would collide
-- with WAIVED, which means something completely different: a decision not to
-- charge at all.
--
-- APPEND ONLY. Nothing updates or deletes a row here. A ledger you can edit
-- afterwards is not a record of anything, which is the same reason
-- order_events is append only. A mistake is corrected by a compensating row,
-- not by a rewrite - and that is why amount_cents allows a negative.
-- ---------------------------------------------------------------------------

create table if not exists payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  -- Kept even if the customer row is later removed: what was taken, and when,
  -- outlives the account it was taken from.
  customer_id   uuid references customers(id) on delete set null,

  -- CARD is written by billing.chargeOrder() the moment Stripe says yes. CASH
  -- is written by a person on the order page. There is no third method, and a
  -- new one is a deliberate change here rather than a free-text surprise.
  method        text not null check (method in ('CARD', 'CASH')),

  -- In cents, like every other amount in this system. Negative is allowed so a
  -- mistake can be corrected by a compensating row rather than by editing one.
  amount_cents  integer not null,

  -- The Stripe charge this row records, when there is one. Null for cash.
  stripe_payment_intent_id text,

  -- WHO TOOK THE MONEY. A name as well as an id, because an ops_users row can
  -- be disabled or renamed and the ledger has to keep saying who it was at the
  -- time. Null id for a card charge, which nobody presses a button for.
  recorded_by      uuid references ops_users(id) on delete set null,
  recorded_by_name text,

  -- DOES THIS MONEY PAY FOR THE WASH?
  --
  -- Almost always yes. It is false for exactly one thing: the $25 show-up
  -- charge kept when a driver made the trip, weighed the bags, the extra
  -- charge was refused and the bags were LEFT ON THE STEP.
  --
  -- Neil's rule: the customer paid for the trip, not for laundry we never
  -- took, so that $25 must never be treated as a wash we owe them. It is a
  -- real payment and belongs in the ledger; it simply does not come off the
  -- price of a wash that did not happen - including the rebooked one tomorrow.
  applies_to_wash boolean not null default true,

  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists payments_by_order on payments (order_id, created_at);

-- WHAT HAS BEEN PAID, KEPT ON THE ORDER, AND RECOMPUTED RATHER THAN INCREMENTED.
--
-- The ledger is the record; this is a sum of it, the same relationship
-- orders.weight_lb already has with bag_labels.weight_lb - "the SUM,
-- recomputed whenever a bag is weighed". It exists because dispatch.balance()
-- is called inside filters on every board and every run, and a per-row query
-- there would be thirty round trips to draw one screen.
--
-- payments.record() recomputes it from the rows on every write, so it cannot
-- drift the way an incremented counter can.
alter table orders
  add column if not exists amount_paid_cents integer not null default 0;

comment on column orders.amount_paid_cents is
  'Sum of payments.amount_cents WHERE applies_to_wash, recomputed on every payment. The ledger is the record; this is a cache so the board can ask about a balance without a query per row.';

-- Row level security on with no policies, like every other table here: the
-- public anon key gets nothing and the server''s service_role key bypasses it.
alter table payments enable row level security;

comment on table payments is
  'How an order was actually paid. Part card and part cash is normal here. There is no CASH payment_status - an order settled partly in cash reads PAID, and these rows say how.';
