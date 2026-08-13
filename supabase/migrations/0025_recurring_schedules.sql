-- Standing orders, plural.
--
-- A customer could have exactly one, because the schedule lived in four
-- columns on their row. Real people want two: sheets and towels on Tuesday
-- morning, everything else on Saturday lunchtime. There was nowhere to put the
-- second one, and the shape of the data was the reason.
--
-- One row per standing order. `time_of_day` is new - the old columns had a
-- weekday but no time, so a Tuesday pickup and a Saturday pickup could not
-- differ in when the van came, which is most of what makes them two different
-- arrangements.

create table if not exists recurring_schedules (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,

  cadence     text not null,

  -- 0 is Sunday, matching JavaScript's getUTCDay so nothing has to be
  -- translated between the database and the code that reads it.
  weekday     integer not null,

  -- The time they asked for, not a window. The window is arithmetic around it,
  -- exactly as it is for a one-off booking - so widening the window later
  -- stays a one-line change and never needs a backfill.
  time_of_day text,

  -- What a fortnightly cadence counts from. Set when the schedule is created
  -- and never moved, so changing the day does not shift the fortnight.
  started_on  date not null default (now() at time zone 'America/New_York')::date,

  -- Skip until this date. Null means running.
  paused_until date,

  status      text not null default 'ACTIVE',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint recurring_cadence_check check (cadence in ('WEEKLY', 'FORTNIGHTLY')),
  constraint recurring_weekday_check check (weekday between 0 and 6),
  constraint recurring_status_check  check (status in ('ACTIVE', 'PAUSED', 'ENDED')),

  -- One schedule per customer per weekday per cadence. Two pickups on the same
  -- Tuesday is not a second arrangement, it is a duplicate - and bookPickup
  -- would refuse the second one anyway, silently, which is worse.
  constraint recurring_no_duplicate_day unique (customer_id, weekday, cadence)
);

alter table recurring_schedules enable row level security;

create index if not exists recurring_schedules_customer_idx
  on recurring_schedules (customer_id) where status = 'ACTIVE';

create index if not exists recurring_schedules_weekday_idx
  on recurring_schedules (weekday) where status = 'ACTIVE';

comment on table recurring_schedules is
  'Standing orders. One row per arrangement, so a customer can have Tuesday '
  'mornings and Saturday lunchtimes at the same time.';
comment on column recurring_schedules.weekday is
  '0 = Sunday, matching JavaScript getUTCDay, so nothing is translated.';
comment on column recurring_schedules.time_of_day is
  'The time they asked for. The promised window is worked out around it, the '
  'same way a one-off booking does it.';

-- Move anything already set up on a customer row into a row of its own.
--
-- Nothing is dropped from `customers`: the columns stay until it is certain
-- nothing reads them, because a dropped column cannot be un-dropped and this
-- is the kind of change that gets noticed a week later.
insert into recurring_schedules (customer_id, cadence, weekday, started_on, paused_until, status)
select
  id,
  recurring_cadence,
  recurring_weekday,
  coalesce(recurring_started_at::date, (now() at time zone 'America/New_York')::date),
  recurring_paused_until,
  'ACTIVE'
from customers
where recurring_cadence is not null
  and recurring_weekday is not null
on conflict (customer_id, weekday, cadence) do nothing;
