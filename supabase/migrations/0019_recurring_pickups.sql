-- A standing order: come every week, or every other week.
--
-- Deliberately NOT a subscription. There is no fee for having one, nothing is
-- charged for the schedule itself, and every pickup it creates is an ordinary
-- order priced by weight like any other. What it saves is the asking.
--
-- Lives on the customer rather than in its own table because a person has one
-- laundry routine, not a portfolio of them. If that ever stops being true this
-- becomes a table and the columns move; until then a second table would be
-- three joins to answer "does this person get a pickup on Tuesday".
--
-- The schedule is offered at the END of a delivery, not at booking: nobody
-- commits to a weekly habit before they have seen the service work once.

alter table customers
  add column if not exists recurring_cadence     text,
  add column if not exists recurring_weekday     smallint,
  add column if not exists recurring_started_at  timestamptz,
  add column if not exists recurring_paused_until date;

alter table customers
  drop constraint if exists customers_recurring_cadence_check;

-- Text with a CHECK rather than an enum, so adding MONTHLY later is one line.
alter table customers
  add constraint customers_recurring_cadence_check
  check (recurring_cadence is null or recurring_cadence in ('WEEKLY', 'FORTNIGHTLY'));

-- 0 = Sunday, matching JavaScript's getDay(), so no translation layer exists
-- to get wrong.
alter table customers
  drop constraint if exists customers_recurring_weekday_check;

alter table customers
  add constraint customers_recurring_weekday_check
  check (recurring_weekday is null or (recurring_weekday >= 0 and recurring_weekday <= 6));

-- A cadence without a day, or a day without a cadence, is a half-written
-- schedule that the booking job would either skip or fire wrongly.
alter table customers
  drop constraint if exists customers_recurring_complete_check;

alter table customers
  add constraint customers_recurring_complete_check
  check (
    (recurring_cadence is null and recurring_weekday is null)
    or (recurring_cadence is not null and recurring_weekday is not null)
  );

-- Marks the orders this created, so an auto-booked pickup can be told apart
-- from one somebody actually asked for - on the ops board, and when working
-- out whether this week's pickup already exists.
alter table orders
  add column if not exists from_schedule boolean not null default false;

create index if not exists customers_recurring_idx
  on customers (recurring_weekday) where recurring_cadence is not null;

comment on column customers.recurring_cadence is
  'WEEKLY, FORTNIGHTLY, or null for no standing order. Not a subscription: '
  'nothing is charged for having one.';
comment on column customers.recurring_weekday is
  'Day of the week the pickup lands on. 0 = Sunday, matching JavaScript.';
comment on column customers.recurring_paused_until is
  'Skip any scheduled pickup on or before this date. How "skip this week" and '
  '"pause until September" are both stored.';
comment on column orders.from_schedule is
  'True when the standing order created this rather than the customer asking.';
