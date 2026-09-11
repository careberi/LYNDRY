-- ---------------------------------------------------------------------------
-- 0087 — a person can pin an order to a laundromat
-- ---------------------------------------------------------------------------
--
-- Neil, 11 September: "we're gonna override Trish's order to go to Fancy K".
--
-- orders.intended_partner_id already existed, but as a GUESS: the laundromat
-- worked out when the order was booked, which the live route overrides the
-- moment it knows better. Order #1975 was planned for Fancy K on 5 Sep, before
-- Best Wash had been added, and the route was right to send it elsewhere.
--
-- A pin is the opposite: a decision a person made, which the route must follow
-- even when another laundromat would be cheaper. So it is recorded as who and
-- when, on the order, beside the plan it turns into a decision. The laundromat
-- itself stays in intended_partner_id - one column for where it is going, and
-- these two say whether that is a guess or an instruction.
--
-- orders.partner_id is unchanged: still the record of where the bags ACTUALLY
-- went, written when they are handed over.
-- ---------------------------------------------------------------------------

alter table orders
  add column if not exists partner_pinned_at timestamptz,
  add column if not exists partner_pinned_by uuid references ops_users(id) on delete set null;

comment on column orders.partner_pinned_at is
  'Set when a person chose this order''s laundromat by hand. The route then '
  'sends it to intended_partner_id whatever is cheaper. Null means '
  'intended_partner_id is only the plan made at booking. See dropoffGroups() '
  'in src/core/dispatch.js.';
