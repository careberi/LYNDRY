-- Bag labels: the sticker that goes on a bag, and what it points at.
--
-- WHY PRE-PRINTED AND BOUND LATER, rather than printed per order.
--
-- The sticker has to exist at the customer's door, and there is no printer in
-- the van. So a roll of stickers is printed in advance with nothing on them but
-- a code, they live in the van, and the driver sticks one on a bag and scans it
-- to bind that code to that order and that bag. This is how every courier does
-- it, and it is the only version that works with one driver and no hardware.
--
-- An unbound label points at nothing. A label from a bag that was delivered
-- last week points at nothing either: binding is cleared when the order is
-- done, so a sticker fished out of a bin is not a window into somebody's order.
--
-- Codes are RANDOM, NEVER SEQUENTIAL. A scanned sticker must not let anybody
-- work out what the next one is. Six characters from a 32-letter alphabet with
-- the ambiguous shapes removed - no O, no 0, no I, no 1 - which is about a
-- billion codes and is still readable out loud in a dark basement.

create table if not exists bag_labels (
  id          uuid primary key default gen_random_uuid(),

  -- What is printed on the sticker and encoded in the QR.
  code        text not null unique,

  -- Which bag this label is currently on. Null means the sticker is blank
  -- stock, or the order it was on is finished.
  order_id    uuid references orders(id) on delete set null,

  -- "Bag 2 of 3". Null while unbound. The total is counted, never stored, so
  -- it cannot disagree with the number of labels actually on the order.
  position    integer,

  -- The audit trail of one sticker's life.
  printed_at  timestamptz not null default now(),
  bound_at    timestamptz,
  released_at timestamptz,

  -- Who bound it. A bag with the wrong label on it is a wrong-address delivery,
  -- which is the expensive failure, so it has to be answerable.
  bound_by    uuid references ops_users(id) on delete set null
);

-- Same as every other table: no policies, so the public anon key can read
-- nothing. The server uses the service_role key, which bypasses this.
alter table bag_labels enable row level security;

-- One label per bag position on an order. Stops a double scan from binding two
-- stickers to "bag 1", which would make the confirm-at-the-door count wrong.
create unique index if not exists bag_labels_order_position_idx
  on bag_labels (order_id, position)
  where order_id is not null;

-- The scan path: code -> label. Already unique, named here for clarity.
create index if not exists bag_labels_order_idx on bag_labels (order_id);

comment on table bag_labels is
  'Pre-printed stickers. A code is bound to an order and a bag position when '
  'the driver scans it at pickup, and released when the order is finished, so '
  'a discarded sticker points at nothing.';
comment on column bag_labels.code is
  'Printed on the sticker and encoded in its QR. Random, never sequential, and '
  'drawn from an alphabet with no O/0/I/1 so it can be read out loud.';
comment on column bag_labels.position is
  'Which bag of the order this is. The total is counted from the other labels '
  'on the same order rather than stored, so the two can never disagree.';

-- Every scan of a public /o/<code> link, whether it resolved or not.
--
-- This is a page anybody with a phone can reach, so it needs a record of who
-- reached it. Rate limiting lives in memory and resets on restart; this is the
-- part that survives, and it is what answers "how did a stranger see that
-- order" if it is ever asked.
create table if not exists bag_label_scans (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  order_id    uuid references orders(id) on delete set null,
  outcome     text not null,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now(),

  constraint bag_label_scans_outcome_check
    check (outcome in ('SHOWN', 'UNBOUND', 'BAD_TOKEN', 'UNKNOWN', 'THROTTLED'))
);

alter table bag_label_scans enable row level security;

create index if not exists bag_label_scans_created_idx on bag_label_scans (created_at desc);

comment on table bag_label_scans is
  'Every hit on a public /o/<code> link. The only record of who looked at a '
  'bag label, because that page has no login.';
