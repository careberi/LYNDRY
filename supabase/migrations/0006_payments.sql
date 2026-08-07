-- 0006_payments.sql
--
-- Card payments, held at Stripe.
--
-- THE RULE THIS SCHEMA EXISTS TO ENFORCE: no card number, expiry date or
-- security code is ever stored here, or anywhere else in this system. What we
-- keep is Stripe's *reference* to a card ("pm_1234..."), plus the brand and
-- last four digits so a text message can say "your Visa ending 4242". Those two
-- are display text and cannot be used to charge anything.
--
-- Handling real card numbers would put this business inside PCI DSS, which is a
-- compliance programme with audits. Letting Stripe hold them keeps us out of it.

-- ---------------------------------------------------------------------------
-- Customers: their Stripe identity and saved card
-- ---------------------------------------------------------------------------

alter table customers
  -- Stripe's own id for this person ("cus_..."). Created the first time they
  -- are sent a payment link, and reused forever after. One per customer.
  add column if not exists stripe_customer_id text unique,

  -- The saved card Stripe should charge ("pm_..."). Null means they have not
  -- added one yet, which is what create_order checks before booking.
  add column if not exists default_payment_method_id text,

  -- Display only. "Visa" and "4242". Never used to charge anything.
  add column if not exists card_brand text,
  add column if not exists card_last4 text,

  -- When they completed the Stripe page. This is our record that they agreed
  -- to us saving the card and charging it for orders they authorise later —
  -- Stripe requires that agreement before any off-session charge.
  add column if not exists payment_authorised_at timestamptz;

-- ---------------------------------------------------------------------------
-- Orders: what happened to the money
-- ---------------------------------------------------------------------------

alter table orders
  -- A text column with a CHECK, not a Postgres enum, so adding a state later
  -- is a one-line change rather than a migration that locks the table.
  --
  --   UNPAID  no charge attempted yet (the normal state before weighing)
  --   PAID    Stripe took the money
  --   FAILED  Stripe refused it — card declined, expired, insufficient funds
  --   WAIVED  Neil decided not to charge. A goodwill gesture, or a redo.
  add column if not exists payment_status text not null default 'UNPAID',

  -- Stripe's reference for the charge attempt ("pi_..."). Kept so a dispute or
  -- a refund can be traced back to exactly one order without guessing.
  add column if not exists stripe_payment_intent_id text,

  add column if not exists paid_at timestamptz,

  -- Why Stripe refused, in Stripe's words. Worth keeping verbatim: "your card
  -- was declined" and "insufficient funds" need different replies.
  add column if not exists payment_failure_reason text,

  -- How many times we have tried. Stops a retry loop quietly hammering a dead
  -- card, and tells us when to stop asking and pick up the phone.
  add column if not exists payment_attempts integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_status_check') then
    alter table orders add constraint orders_payment_status_check
      check (payment_status in ('UNPAID', 'PAID', 'FAILED', 'WAIVED'));
  end if;
end $$;

-- Everything the driver's run sheet and the chase-up list need to find.
create index if not exists orders_payment_status_idx on orders (payment_status);

-- ---------------------------------------------------------------------------
-- payment_links — the short link we text
-- ---------------------------------------------------------------------------
--
-- Two reasons this table exists rather than texting the Stripe URL directly:
--
--   1. Carriers score a texted link partly by its domain. Every link LYNDRY
--      sends should be on lyndry.com, the domain registered to the brand.
--      This table is what lyndry.com/pay/<token> looks up.
--
--   2. A Stripe Checkout URL expires after 24 hours. Storing the session id
--      rather than the URL means a stale link can mint a fresh session instead
--      of showing the customer an error page.

create table if not exists payment_links (
  id uuid primary key default gen_random_uuid(),

  -- The random part of lyndry.com/pay/<token>. Long enough that it cannot be
  -- guessed, which is the only thing protecting it — there is no login here.
  token text not null unique,

  customer_id uuid not null references customers (id) on delete cascade,

  -- Stripe's checkout session ("cs_..."), and the URL it handed us.
  stripe_session_id text,
  url text,

  -- Checkout sessions expire; so does this link. A customer opening a dead
  -- link gets a new session rather than a dead end.
  expires_at timestamptz,

  -- Set when Stripe's webhook tells us the card was saved. A used link stops
  -- working, so a forwarded text cannot put someone else's card on the account.
  completed_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists payment_links_customer_idx on payment_links (customer_id);

-- Row level security on, no policies — the same as every other table here.
-- That denies all access through Supabase's public anon key. The server holds
-- the service_role key, which bypasses RLS entirely.
alter table payment_links enable row level security;
