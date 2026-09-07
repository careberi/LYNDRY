-- ---------------------------------------------------------------------------
-- 0074 — the cap counts ORDERS, and a slot is claimed when one is booked.
--
-- This replaces the cap added one migration ago, which counted people given the
-- promotion. Neil settled the rule with the trade in front of him: "give it to
-- everyone, but only the first 20 people who actually book and order with us
-- get it". So the promotion is handed out freely and the scarce thing is the
-- ORDER, which is what the advert says anyway.
--
-- THE SLOT IS TAKEN AT BOOKING, NOT AT THE WEIGH-IN, and that is the whole
-- design. Everything else about a promotion is decided when the order is priced,
-- hours later at a laundromat. If the cap were decided there too, the twenty
-- first customer would be told their pickup was booked and free, and would find
-- out it was not when the price text arrived. Claiming at booking means the
-- answer is known at the only moment the customer is actually asking.
--
-- WHICH MAKES A CANCELLED ORDER A SLOT THAT COMES BACK. An order that never
-- happens must not hold one of the twenty for ever - see releaseSlot() in
-- src/core/promotions.js, called from orders.transition().
--
-- Null max_orders is what every existing promotion is: no cap, exactly as
-- before, and no claim is ever taken for it.
-- ---------------------------------------------------------------------------

-- max_grants lasted a day and was never set on anything, so this is a rename
-- rather than a second column to keep in step.
alter table promotions rename column max_grants to max_orders;

alter table promotions
  drop constraint if exists promotions_max_grants_check;

alter table promotions
  add constraint promotions_max_orders_check
  check (max_orders is null or max_orders > 0);

-- WHICH ORDER TOOK THIS PERSON'S SLOT. Null means they hold the promotion and
-- have not booked against it - which for a capped promotion is the difference
-- between holding it and having it.
--
-- Separate from redeemed_at and uses, which are about the money actually coming
-- off at the weigh-in. A claim is a reservation; a redemption is a spend, and
-- an order can be claimed and then cancelled before it is ever redeemed.
alter table customer_promotions
  add column if not exists claimed_order_id uuid references orders (id) on delete set null,
  add column if not exists claimed_at timestamptz;

-- ONE CLAIM PER ORDER. Two grants both pointing at the same order would each
-- count against the twenty for one piece of laundry.
create unique index if not exists customer_promotions_one_claim_per_order
  on customer_promotions (claimed_order_id) where claimed_order_id is not null;

comment on column promotions.max_orders is
  'How many orders may ever use this. Null means no limit. A slot is claimed '
  'when an order is booked and released if it is cancelled, so the answer is '
  'known while the customer is still asking rather than at the weigh-in.';

comment on column customer_promotions.claimed_order_id is
  'The order holding this grants slot against a capped promotion. Null means '
  'they hold it but have not booked against it. Not the same as redeemed_at, '
  'which is the money actually coming off.';
