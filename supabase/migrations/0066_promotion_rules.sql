-- ---------------------------------------------------------------------------
-- 0066 — a promotion gets an audience, an expiry and limits.
--
-- WHAT WAS ALREADY RIGHT, and is worth saying because a redesign proposal
-- assumed otherwise: a promotion is already an OBJECT ATTACHED TO A PERSON, not
-- a code. customer_promotions records who was given what, when, whether they
-- spent it and on which order; ending a promotion never takes it off somebody
-- already told they had it; and the discount is written onto the order so it
-- survives the promotion changing. None of that needed rebuilding.
--
-- WHAT WAS ACTUALLY MISSING is everything about who gets it and for how long.
-- There was exactly one way to give a promotion out - "every new number" - and
-- a grant lasted for ever.
--
-- AUDIENCE REPLACES auto_grant AS THE SOURCE OF TRUTH. The old boolean said one
-- thing ("new numbers") and there was no way to say anything else. The column
-- stays because dropping a column is destructive and it costs nothing, but
-- nothing reads it any more - same treatment as customers.recurring_*. The
-- "only one automatic promotion" index moves onto the audience with it.
--
--   NEW_NUMBERS    given the moment an unknown number texts in, before they
--                  have booked anything. At most one promotion may do this.
--   NEVER_ORDERED  anybody with no delivered order. Issued in one go by hand.
--   EVERYONE       every active customer. Issued in one go by hand.
--   SPECIFIC       nobody automatically. Given to one person at a time from
--                  their own profile.
--
-- EXPIRY IS PER GRANT, NOT PER PROMOTION, and that distinction matters. "Seven
-- days from when you got it" is a different promise to every holder, so the
-- date has to live on the grant. promotions.expires_days is the rule;
-- customer_promotions.expires_at is the promise made to one person, stamped
-- when it is granted and never recomputed - so changing the rule later cannot
-- shorten a promise somebody has already been given.
-- ---------------------------------------------------------------------------

alter table promotions
  add column if not exists audience text not null default 'SPECIFIC'
    check (audience in ('NEW_NUMBERS', 'NEVER_ORDERED', 'EVERYONE', 'SPECIFIC'));

-- The smallest order this may be used on, in cents. NOT the same thing as
-- pricing.minimumCents, which is the floor on what any order costs: this is
-- "valid on orders over $30" and is checked against the price BEFORE the
-- discount comes off.
alter table promotions
  add column if not exists min_order_cents integer
    check (min_order_cents is null or min_order_cents > 0);

-- The most this may ever take off, in cents. Only meaningful on a percentage:
-- "30% off, up to $20" stops a heavy load costing us more than intended.
alter table promotions
  add column if not exists max_discount_cents integer
    check (max_discount_cents is null or max_discount_cents > 0);

-- How long a grant lasts. Null means it never expires, which is what every
-- existing grant is and stays.
alter table promotions
  add column if not exists expires_days integer
    check (expires_days is null or expires_days > 0);

alter table customer_promotions
  add column if not exists expires_at timestamptz;

-- Existing rows keep behaving exactly as they did.
update promotions set audience = 'NEW_NUMBERS' where auto_grant and audience = 'SPECIFIC';

-- The rule moves from the boolean to the audience. Still at most one promotion
-- handed out automatically: two would both attach to a new number and the order
-- of application would silently decide what somebody got.
drop index if exists promotions_one_auto_grant;
create unique index if not exists promotions_one_automatic
  on promotions ((true)) where audience = 'NEW_NUMBERS' and status = 'ACTIVE';

comment on column promotions.audience is
  'Who this is for: NEW_NUMBERS (automatic on first text, at most one), '
  'NEVER_ORDERED and EVERYONE (issued in one go by hand), SPECIFIC (given to '
  'one person from their profile). Replaces auto_grant, which nothing reads.';

comment on column customer_promotions.expires_at is
  'When this persons grant runs out. Stamped from promotions.expires_days at '
  'the moment it is granted and never recomputed, so changing the rule cannot '
  'shorten a promise already made. Null means it does not expire.';
