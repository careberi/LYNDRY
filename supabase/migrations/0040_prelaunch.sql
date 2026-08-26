-- ---------------------------------------------------------------------------
-- 0040 — pre-launch: a switch, promotions, and a record of what we blasted.
--
-- Three things Neil asked for, and they arrive together because they are one
-- situation: the service is not ready to take orders, but the number is live
-- and people are texting it. We want to keep those people, tell them why, and
-- owe them something when we open.
--
-- THE SWITCH IS NOT A FEATURE FLAG. It changes what the AI says AND what the
-- booking code will do, and the second half is the one that matters: the
-- prompt is a request, `bookPickup()` is a refusal. Same split as the service
-- area - the AI explains, the code decides - because a model that is asked
-- nicely not to book will eventually book.
-- ---------------------------------------------------------------------------

-- --- The switch ------------------------------------------------------------
--
-- Exactly one row, forced by the primary key being a constant. A settings
-- table that can hold two rows is a settings table that will, and then half
-- the code reads one and half reads the other.
create table if not exists app_settings (
  id boolean primary key default true check (id),

  taking_orders boolean not null default true,

  -- Why we are shut, in Neil's own words, handed to the AI to work into its
  -- reply. Only meaningful while taking_orders is false. Nullable because
  -- "we are open" needs no explanation - Neil's point exactly: turning it ON
  -- takes no message.
  paused_reason text,

  updated_at timestamptz not null default now(),
  updated_by  uuid references ops_users (id) on delete set null
);

insert into app_settings (id) values (true) on conflict (id) do nothing;

-- --- Promotions ------------------------------------------------------------

create table if not exists promotions (
  id uuid primary key default gen_random_uuid(),

  name text not null,

  -- THE SENTENCE THE AI IS ALLOWED TO SAY. It is written here by a person
  -- rather than composed by the model, because a discount is money and the
  -- rule everywhere else in this system is that the AI never invents money.
  blurb text not null,

  kind  text not null check (kind in ('PERCENT_OFF', 'AMOUNT_OFF')),
  -- Whole percent for PERCENT_OFF, whole cents for AMOUNT_OFF. Never a
  -- decimal, for the same reason prices are not.
  value integer not null check (value > 0),

  applies_to text not null default 'FIRST_ORDER'
    check (applies_to in ('FIRST_ORDER', 'EVERY_ORDER')),

  -- Given to any NEW number automatically the moment they text in. This is
  -- what makes "text us before we open and get 20% off" work without anybody
  -- typing a code.
  auto_grant boolean not null default false,

  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ENDED')),

  starts_at timestamptz,
  ends_at   timestamptz,

  created_at timestamptz not null default now(),
  created_by uuid references ops_users (id) on delete set null
);

-- Only one promotion may be auto-granted at a time. Two would both attach to
-- a new customer and the order of application would decide what they got.
create unique index if not exists promotions_one_auto_grant
  on promotions ((true)) where auto_grant and status = 'ACTIVE';

-- --- Who holds what --------------------------------------------------------
--
-- A grant is a promise to a specific person, kept separately from the
-- promotion itself so that ending a promotion never takes it away from
-- somebody who was already told they had it.
create table if not exists customer_promotions (
  id uuid primary key default gen_random_uuid(),

  customer_id  uuid not null references customers (id) on delete cascade,
  promotion_id uuid not null references promotions (id) on delete cascade,

  granted_at  timestamptz not null default now(),
  redeemed_at timestamptz,
  order_id    uuid references orders (id) on delete set null,

  -- Somebody cannot hold the same promotion twice.
  unique (customer_id, promotion_id)
);

create index if not exists customer_promotions_open_idx
  on customer_promotions (customer_id) where redeemed_at is null;

-- --- What a discount took off ----------------------------------------------
--
-- Recorded on the order rather than recomputed, because the promotion it came
-- from can end or change and the order still has to say what was actually
-- charged and why.
alter table orders add column if not exists discount_cents integer not null default 0
  check (discount_cents >= 0);

alter table orders add column if not exists promotion_id uuid
  references promotions (id) on delete set null;

-- --- Text blasts -----------------------------------------------------------
--
-- The campaign record. Every individual text still goes through notify.js and
-- lands in `messages` like any other, so this is not a second copy of what was
-- sent - it is the answer to "what did I send, to whom, and how many got it".
create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),

  body     text not null,
  audience text not null,

  sent_count    integer not null default 0,
  skipped_count integer not null default 0,

  created_at timestamptz not null default now(),
  created_by uuid references ops_users (id) on delete set null
);

alter table app_settings        enable row level security;
alter table promotions          enable row level security;
alter table customer_promotions enable row level security;
alter table broadcasts          enable row level security;

comment on table app_settings is
  'One row. taking_orders false means the AI says we are not booking and '
  'bookPickup() refuses - the prompt explains, the code enforces.';

comment on column promotions.blurb is
  'The sentence the AI may say about this promotion. Written by a person: a '
  'discount is money, and the AI never invents money.';

comment on table customer_promotions is
  'A promise to one person. Kept apart from the promotion so ending a '
  'promotion never withdraws it from somebody already told they had it.';
