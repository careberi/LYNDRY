-- ---------------------------------------------------------------------------
-- 0050 — reconciling two scales, and what each side is billed.
--
-- NEIL'S RULES, in his words:
--
--   The CUSTOMER is charged the HEAVIER of the driver's weight and the
--   laundromat's. Already true - settleWeight() has done that since two-scale
--   settlement went in. Nothing below changes it.
--
--   The LAUNDROMAT is billed THEIR OWN reported weight, whether that is higher
--   or lower than ours - but only while the two agree closely enough. Past the
--   exception threshold nothing is invoiced automatically; it is raised, and an
--   admin sets the poundage by hand.
--
--   THREE BANDS rather than one line: normal, acceptable-but-recorded, and
--   exception. The middle band is the interesting one - it is not a problem
--   worth stopping for, and it is worth counting, because a partner who sits
--   in it every single time is a partner with a scale that needs replacing.
--
-- WHY THE PARTNER'S BILL IS A COLUMN. Until now their figure was a cross-check
-- and nothing else: CLAUDE.md said in as many words that partner_weight_lb is
-- never read by the pricing code, and it still is not - the CUSTOMER's price
-- does not come from it. But what we PAY them now does, and that is money
-- leaving the business, so it gets recorded rather than recomputed. A figure
-- that is recalculated every time somebody opens a page is one that can quietly
-- change after an invoice has gone out.
--
-- ONE SET OF THRESHOLDS FOR EVERYBODY, and that is Neil's call too: "it doesn't
-- matter if they have a bad scale. They need to get another one if they're
-- going to be doing our service." So there is no per-partner override here, on
-- purpose. Adding one later would mean a bad scale quietly loosening its own
-- tolerance, which is the opposite of the point.
-- ---------------------------------------------------------------------------

-- --- The thresholds, which the admin sets -----------------------------------
--
-- Percentages stored as whole numbers (3 means 3%) because that is how they are
-- typed and read. Stored on the single app_settings row beside taking_orders,
-- so there is one place the business is configured rather than two.
alter table app_settings add column if not exists weight_normal_pct numeric(5,2) not null default 3;
alter table app_settings add column if not exists weight_acceptable_pct numeric(5,2) not null default 5;

-- THE FLOOR, so a small order is not flagged over an ounce. 5% of a 10 lb bag
-- is half a pound, which is inside what two honest scales differ by; without a
-- floor every small order would raise an exception and the queue would be
-- noise. Neil asked for this specifically.
alter table app_settings add column if not exists weight_min_lb numeric(5,2) not null default 2;

-- --- What the laundromat is invoiced ----------------------------------------

alter table orders add column if not exists partner_bill_lb numeric(6,2);

-- Which band the two weights fell into when it was settled. Kept so the middle
-- band can be counted per partner without recomputing it against thresholds
-- that may have moved since.
alter table orders add column if not exists weight_band text
  check (weight_band is null or weight_band in ('NORMAL', 'ACCEPTABLE', 'EXCEPTION'));

alter table orders add column if not exists partner_bill_settled_at timestamptz;

-- Null when the arithmetic settled it, an ops user when a person did. Same
-- shape as issues.resolved_by, and for the same reason: "who decided this"
-- is the question asked afterwards.
alter table orders add column if not exists partner_bill_by uuid
  references ops_users (id) on delete set null;

create index if not exists orders_weight_band_idx
  on orders (weight_band) where weight_band is not null;

comment on column orders.partner_bill_lb is
  'The poundage the laundromat is invoiced for. Their own reported weight while '
  'the two scales agree within tolerance; set by hand by an admin when they do '
  'not. Recorded rather than recomputed, because it is money leaving the '
  'business and must not change after an invoice has gone out.';

comment on column orders.weight_band is
  'How far apart the two scales were when this was settled: NORMAL, ACCEPTABLE '
  'or EXCEPTION. Kept so a partner who sits in ACCEPTABLE every time can be '
  'spotted without recomputing against thresholds that may have moved.';
