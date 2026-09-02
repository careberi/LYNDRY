-- ---------------------------------------------------------------------------
-- 0048 — where an order is expected to go, decided when it is booked.
--
-- NEIL'S CALL: "the system should have the address where the order is going as
-- soon as the order is placed."
--
-- Until now the laundromat was worked out live, every time a board was drawn,
-- and only written down at orders.partner_id once the driver had actually
-- dropped the bags off. That is fine for a routing board and useless for
-- everything else: a driver looking at his round the night before saw a stop
-- called "a laundromat" with no address on it, because nothing had been chosen
-- yet and nothing could be until somebody loaded that page at the right time
-- of day. The screen even offered an "I'm here" button for a place it could
-- not name.
--
-- THREE COLUMNS, NOT ONE, AND THE DIFFERENCE MATTERS:
--
--   intended_partner_id   where we PLAN to take it. Set at booking.
--   partner_id            where it ACTUALLY went. Set at drop-off. Unchanged.
--
-- Keeping them apart is the same rule as price_per_lb_cents and today's rate:
-- what we expected and what happened are different facts, and collapsing them
-- loses the ability to ask why they differed. "We meant to take it to Fancy K
-- and ended up at Bergen Wash" is exactly the sort of thing worth being able
-- to see later.
--
-- A PLAN, NOT A LOCK. The choice is made days ahead in some cases, and a
-- laundromat can be shut that day, full, or closed for a fortnight by then.
-- Anything reading this has to treat it as a starting position and re-check
-- before the bags actually change hands - the same way an order's assigned
-- driver is a starting position that a person can override.
--
-- Nullable, and that is a real state rather than a gap to tidy away: there may
-- be no partner open on that weekday, none within range, or none added at all.
-- An order with no plan is one somebody should look at, which is why the run
-- screen says so rather than inventing a destination.
-- ---------------------------------------------------------------------------

alter table orders add column if not exists intended_partner_id uuid
  references partners (id) on delete set null;

-- When the choice was made, so a plan made a week ago can be told from one made
-- this morning. A stale plan is not wrong, but it is worth re-checking.
alter table orders add column if not exists intended_partner_at timestamptz;

create index if not exists orders_intended_partner_idx
  on orders (intended_partner_id) where intended_partner_id is not null;

comment on column orders.intended_partner_id is
  'The laundromat we PLAN to take this order to, chosen when it was booked so '
  'the driver has an address from the moment the order exists. A plan, not a '
  'lock: re-check before handing the bags over, because a partner can be shut '
  'or full by the day it matters. orders.partner_id is where it actually went.';

comment on column orders.intended_partner_at is
  'When that plan was made. A choice from a week ago is worth re-checking; one '
  'from this morning is not.';
