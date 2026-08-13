-- ---------------------------------------------------------------------------
-- 0037 — when a driver actually works.
--
-- The system knew when a LAUNDROMAT was open and nothing at all about when its
-- own drivers were. So an order booked for Sunday morning was assigned to
-- somebody who does not work Sundays, and nothing anywhere said so.
--
-- Same shape as partner_hours, deliberately - one row per weekday, absence
-- means not working, and several rows on a day is a split shift. A driver who
-- does mornings and then evenings is a real thing.
--
-- A DRIVER WITH NO HOURS AT ALL IS TREATED AS ALWAYS AVAILABLE, which is the
-- opposite of the partner rule and is the right default here. A partner with no
-- hours is somebody we have not asked yet, and sending a van to a shut door
-- costs a wasted trip. A driver with no hours is the single-van business that
-- has never needed a rota, and refusing to assign them anything would stop the
-- system dead the moment somebody is added.
-- ---------------------------------------------------------------------------

create table if not exists ops_user_hours (
  id           uuid primary key default gen_random_uuid(),
  ops_user_id  uuid not null references ops_users (id) on delete cascade,

  -- 0 = Sunday, matching JavaScript's getDay() and Postgres's dow, exactly as
  -- partner_hours does. One convention for both or somebody will convert wrong.
  weekday   smallint not null,
  starts_at time not null,
  ends_at   time not null,

  created_at timestamptz not null default now(),

  constraint ops_user_hours_weekday_check check (weekday between 0 and 6),
  constraint ops_user_hours_order_check   check (ends_at > starts_at),
  constraint ops_user_hours_unique        unique (ops_user_id, weekday, starts_at)
);

alter table ops_user_hours enable row level security;

create index if not exists ops_user_hours_person_idx
  on ops_user_hours (ops_user_id, weekday);

comment on table ops_user_hours is
  'When somebody works, one row per weekday. NO ROWS AT ALL means always '
  'available - the opposite of partner_hours, because a driver with no rota is '
  'the normal case for a one-van business and refusing them work would stop '
  'the system. Several rows on one weekday is a split shift.';
