-- ---------------------------------------------------------------------------
-- 0068 — a promotion can be good for more than one order.
--
-- Neil's ask: "first order only, every order, or their next N orders - and I
-- should be able to type the number."
--
-- IT ALSO FIXES A REAL BUG. applies_to already offered EVERY_ORDER, and it did
-- not work: redeem() stamped redeemed_at the first time it was used, and
-- heldBy() only returns grants with redeemed_at null - so "every order" was
-- consumed after one order exactly like "first order". Nobody had noticed
-- because no promotion has ever been redeemed twice.
--
-- The count is what fixes both. customer_promotions.uses is how many orders
-- this person has actually spent it on; redeemed_at now means "used up", and
-- is only stamped when there is a limit and the count has reached it. An
-- EVERY_ORDER grant never reaches one, which is what it always should have
-- meant.
--
-- THE LIMIT IS COPIED ONTO THE GRANT, not read back off the promotion.
-- "Your next five orders" is a promise to one person, and editing the
-- promotion to two later must not take three orders off somebody who was
-- already told five - the same rule as expires_at, and the same reason.
-- ---------------------------------------------------------------------------

alter table promotions
  drop constraint if exists promotions_applies_to_check;

alter table promotions
  add constraint promotions_applies_to_check
  check (applies_to in ('FIRST_ORDER', 'EVERY_ORDER', 'NEXT_ORDERS'));

-- How many orders NEXT_ORDERS is good for. Null for the other two: FIRST_ORDER
-- is one by definition and EVERY_ORDER has no limit at all.
alter table promotions
  add column if not exists use_limit integer
    check (use_limit is null or use_limit > 0);

alter table customer_promotions
  add column if not exists uses integer not null default 0 check (uses >= 0);

alter table customer_promotions
  add column if not exists use_limit integer
    check (use_limit is null or use_limit > 0);

-- Anything already redeemed has been used once. Anything not, none.
update customer_promotions set uses = 1 where redeemed_at is not null and uses = 0;

-- --- The sentence the AI may say is now optional ----------------------------
--
-- Neil's ask. He texts somebody himself - "you were one of the first to reach
-- out, so I can do 30% instead of 20" - and then wants the offer on their
-- account WITHOUT the AI announcing it again in its next reply. A promotion
-- with no blurb is silent: it comes off the price and says nothing.
--
-- The rule it does not change: the AI still never invents one. No blurb means
-- it is told nothing at all, which is a stronger guarantee than a blurb it is
-- allowed to repeat.
alter table promotions alter column blurb drop not null;

comment on column promotions.use_limit is
  'How many orders a NEXT_ORDERS promotion is good for. Null for FIRST_ORDER '
  '(one by definition) and EVERY_ORDER (no limit).';

comment on column customer_promotions.uses is
  'How many orders this person has spent it on. redeemed_at means used up, and '
  'is stamped only when uses reaches the grants own use_limit - so an '
  'EVERY_ORDER grant never closes.';

comment on column customer_promotions.use_limit is
  'The limit copied from the promotion at the moment it was granted, so '
  'editing the promotion later cannot take orders off a promise already made. '
  'Same rule as expires_at.';

comment on column promotions.blurb is
  'The one sentence the AI may say about this. NULL means the promotion is '
  'silent: it discounts the order and the AI is told nothing about it, which '
  'is what an offer made by hand in a text needs.';
