-- ---------------------------------------------------------------------------
-- 0026 — opening hours a computer can read.
--
-- `partners.hours` is free text and stays that way. 0023 said the day something
-- needed to answer "are they open at three on a Tuesday" would be the day to
-- structure it. That day is here: the dispatch board sequences a real run and
-- sends bags to a laundromat, and it must not route a driver to a shut door.
--
-- One row per partner per weekday. A weekday with no row is CLOSED — absence
-- means closed rather than unknown, because a routing decision has to resolve
-- to yes or no and "we never filled it in" cannot be treated as open.
--
-- Two rows on the same weekday are allowed, and that is the point of not using
-- a pair of columns on `partners`: a laundromat that shuts for lunch, or opens
-- early and again in the evening, is a real thing. Routing treats a time as
-- open if it falls in ANY of that day's rows.
--
-- The free-text `hours` column survives as the human note — "call ahead on
-- Sundays" is worth keeping and is not something to route by.
-- ---------------------------------------------------------------------------

create table if not exists partner_hours (
  id         uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners (id) on delete cascade,

  -- 0 = Sunday, matching JavaScript's getDay() and Postgres's dow, so nothing
  -- has to translate between the database and the page.
  weekday smallint not null,

  -- Local wall-clock time in the service timezone. `time` not `timestamptz`:
  -- a laundromat opens at seven in the morning whatever the date is, and
  -- pinning it to an instant would move it twice a year with the clocks.
  opens_at  time not null,
  closes_at time not null,

  created_at timestamptz not null default now(),

  constraint partner_hours_weekday_check
    check (weekday between 0 and 6),

  -- Closing after opening. A row that closes before it opens is a typo, and
  -- silently accepting it would make a partner look shut all day.
  constraint partner_hours_order_check
    check (closes_at > opens_at),

  -- The same weekday twice with the same opening time is a double-submitted
  -- form, not a split shift.
  constraint partner_hours_unique
    unique (partner_id, weekday, opens_at)
);

-- Every table here has row level security on with no policies, which denies
-- everything through the public anon key. The server uses the service_role key
-- and bypasses it.
alter table partner_hours enable row level security;

create index if not exists partner_hours_partner_idx
  on partner_hours (partner_id, weekday);

comment on table partner_hours is
  'Opening hours a computer can read, one row per weekday per partner. A '
  'weekday with no row is closed. Several rows on one weekday is a split '
  'shift, and a time is open if it falls in any of them.';

comment on column partner_hours.weekday is
  '0 = Sunday, matching JavaScript getDay() and Postgres dow.';

comment on column partner_hours.opens_at is
  'Local wall-clock time in the service timezone, deliberately not an '
  'instant - seven in the morning is seven in the morning in June and in '
  'December.';

-- The free-text column is now the human aside rather than the whole story.
comment on column partners.hours is
  'A free-text note for a person - "call ahead on Sundays". The hours ROUTING '
  'reads are in partner_hours. Kept because a sentence holds things seven '
  'open/close pairs cannot.';
