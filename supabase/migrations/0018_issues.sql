-- Something went wrong and a person has to deal with it.
--
-- Until now, handing a conversation to a human meant a line in the server log
-- and a text to a number that was never configured. Nothing survived a restart
-- and nothing appeared on any screen, so a customer whose shirt was ruined got
-- "someone will come back to you shortly" and nobody ever did.
--
-- An issue is a durable record with exactly one property that matters: it
-- stays OPEN until a person closes it. Not until the conversation moves on,
-- not until the AI thinks it is handled. A person.

create table if not exists issues (
  id            uuid primary key default gen_random_uuid(),

  customer_id   uuid not null references customers(id) on delete cascade,

  -- The order it is about, when it is about one. Nullable because "do you
  -- deliver to Hoboken" is a question for a human that belongs to no order.
  order_id      uuid references orders(id) on delete set null,

  -- One line from the AI explaining why it gave up, so whoever picks this up
  -- knows what they are walking into before they read the thread.
  reason        text not null,

  -- What the customer actually said, kept alongside the AI's summary because
  -- their own words matter when someone is upset.
  customer_said text,

  status        text not null default 'OPEN'
                check (status in ('OPEN', 'RESOLVED')),

  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,

  -- Who closed it. Kept even if they later leave, which is why this is a
  -- set null rather than a cascade.
  resolved_by   uuid references ops_users(id) on delete set null,
  resolution    text
);

-- The dashboard asks "is anything open" on every page load, so that lookup is
-- the one worth an index.
create index if not exists issues_open_idx
  on issues (created_at desc) where status = 'OPEN';

create index if not exists issues_customer_idx on issues (customer_id, created_at desc);

-- At most ONE open issue per customer.
--
-- Without this, a customer sending three angry texts in three minutes creates
-- three identical flags and gets three identical replies, which is exactly
-- what happened in testing. One conversation, one issue.
create unique index if not exists issues_one_open_per_customer
  on issues (customer_id) where status = 'OPEN';

-- Same rule as every other table: RLS on, no policies, so the public anon key
-- can read nothing. The server uses the service role and bypasses it.
alter table issues enable row level security;

comment on table issues is
  'Something a person has to deal with. Stays OPEN until a human resolves it '
  'on the ops screens; nothing closes it automatically.';
