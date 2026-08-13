-- What happened to an order, and who did it.
--
-- Until now an order carried only its CURRENT state. You could see it was
-- delivered; you could not see that it was weighed twice, that the second
-- weight was 4 lb lighter, that a laundromat disagreed, or which driver tapped
-- which button. When a customer rings up about a charge, "the order says $80"
-- is not an answer - the question is always how it got to $80.
--
-- One row per thing that happened, append only. Nothing ever updates or
-- deletes a row here: a log you can edit is not a log, and the value of this
-- table is entirely that it cannot be tidied up after the fact.
--
-- WHY NOT A GENERIC AUDIT TABLE over every column. Because almost none of it
-- is interesting. "notes changed from null to null" is noise, and a log that
-- is mostly noise is a log nobody reads, which is the same as not having one.
-- Events are written deliberately, at the handful of moments that matter.

create table if not exists order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,

  -- What kind of thing happened. Text with a CHECK rather than an enum, so
  -- adding a kind later is a one-line change.
  kind       text not null,

  -- One sentence a person can read, written at the moment it happened. This is
  -- the column somebody actually looks at.
  summary    text not null,

  -- The before and after, when there is one. Text rather than typed columns
  -- because a weight, a status and a price are all different shapes and this
  -- is for reading, not for arithmetic.
  was        text,
  became     text,

  -- WHO. Null means it was not a person: a webhook, the AI, a scheduled run.
  -- `actor` says which of those in words, so a null never has to be guessed at.
  ops_user_id uuid references ops_users(id) on delete set null,
  actor       text not null default 'system',

  -- WHY, when there is a why. A driver correcting a weight, a partner
  -- disagreeing, a charge being waived - the reason is the whole point of the
  -- row in those cases.
  reason     text,

  created_at timestamptz not null default now(),

  constraint order_events_kind_check
    check (kind in (
      'CREATED', 'STATUS', 'WEIGHT', 'PRICE', 'PAYMENT', 'REFUND',
      'LABEL', 'PARTNER', 'PARTNER_WEIGHT', 'NOTE', 'CANCELLED', 'SCHEDULE'
    ))
);

alter table order_events enable row level security;

-- The order page reads these newest first, and nothing else queries them.
create index if not exists order_events_order_idx
  on order_events (order_id, created_at desc);

comment on table order_events is
  'Append only. What happened to an order, in the order it happened, with who '
  'did it and why. Never updated, never deleted - a log that can be tidied up '
  'is not evidence of anything.';
comment on column order_events.actor is
  'Who or what caused it when there is no ops user: "driver", "customer", '
  '"partner", "system". So a null ops_user_id never has to be guessed at.';
comment on column order_events.summary is
  'One sentence, written when it happened. The column a person actually reads.';
