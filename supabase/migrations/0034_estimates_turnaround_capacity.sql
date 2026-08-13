-- ---------------------------------------------------------------------------
-- 0034 — the four things ROUTING.md says earn their place immediately.
--
-- None of them need an optimiser. Each fixes something the routing engine
-- currently gets wrong or cannot see at all.
-- ---------------------------------------------------------------------------

-- --- 1. A weight estimate that improves ------------------------------------
--
-- The router assumed 12.5 lb for anything unweighed, and a comment called it
-- "the honest floor". IT IS NOT A FLOOR. 12.5 lb is where a $25 minimum meets
-- $2 a pound - a BILLING break-even. Somebody can hand over 7 lb and still owe
-- $25, so using the billing figure as a physical one over-states small loads,
-- and the van capacity and partner cost built on it inherit the error.
--
-- So it becomes an estimate that gets better: the mean of what this customer's
-- bags have actually weighed, with 12.5 lb only as a cold start for somebody
-- nobody has weighed yet.
alter table customers add column if not exists estimated_weight_lb numeric(6, 2)
  check (estimated_weight_lb is null or estimated_weight_lb > 0);

comment on column customers.estimated_weight_lb is
  'Rolling mean of this customer''s weighed orders, recomputed at each weighing. '
  'Null until they have been weighed once, when the cold-start default applies. '
  'An estimate for planning - never used for billing, which is always the scale.';

-- --- 2. Turnaround, and the hour after which it is tomorrow's wash ----------
--
-- A laundromat at 90c a pound that takes 30 hours is a different business from
-- one at $1.15 that reliably finishes in 10, and the router could not tell them
-- apart - it compared price and distance and knew nothing about time. On a
-- next-day promise that is the difference between keeping it and breaking it.
alter table partners add column if not exists turnaround_minutes integer
  check (turnaround_minutes is null or turnaround_minutes > 0);

alter table partners add column if not exists dropoff_cutoff time;

comment on column partners.turnaround_minutes is
  'How long they take from drop-off to ready. Null means unknown, which is not '
  'the same as fast - routing treats unknown as a risk rather than as zero.';

comment on column partners.dropoff_cutoff is
  'Arrive after this and it is tomorrow''s wash, whatever their closing time. '
  'Null means the closing time is the cutoff.';

-- --- 3. The van, so capacity can be a hard constraint -----------------------
--
-- Nothing stopped the router loading 500 lb into a 400 lb van, because the van
-- did not exist as far as the system was concerned. Capacity is a HARD
-- constraint: a plan that violates it is not expensive, it is impossible.
--
-- One row per van, pointed at whoever is driving it. Clip count lives here too
-- rather than in config, because it is a property of a particular van's kit and
-- a second van will have a different number.
create table if not exists vehicles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  driver_id     uuid references ops_users (id) on delete set null,

  max_weight_lb integer not null default 400 check (max_weight_lb > 0),
  max_bags      integer not null default 40  check (max_bags > 0),
  clip_count    smallint not null default 50 check (clip_count > 0),

  status        text not null default 'ACTIVE',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint vehicles_status_check check (status in ('ACTIVE', 'RETIRED'))
);

alter table vehicles enable row level security;

create index if not exists vehicles_driver_idx on vehicles (driver_id);

comment on table vehicles is
  'One row per van. Capacity is a hard constraint on any route, not a cost to '
  'weigh against others.';

-- --- 4. A partner assignment that can still change --------------------------
--
-- Until a bag is physically handed over, which laundromat it is going to is an
-- INTENTION. A pickup fifteen minutes later near a different partner should be
-- able to move it. Scanning it in at the counter is what settles it.
--
-- On the bag rather than the order because that is where the sticker and the
-- weight already live; orders.partner_id stays as the record of where the order
-- actually went.
alter table bag_labels add column if not exists intended_partner_id uuid
  references partners (id) on delete set null;

alter table bag_labels add column if not exists partner_locked boolean not null default false;

comment on column bag_labels.intended_partner_id is
  'Where this bag is currently meant to go. Freely changeable while it is in '
  'the van; partner_locked is set when it is actually handed over, and after '
  'that orders.partner_id is the record of where it went.';
