-- ---------------------------------------------------------------------------
-- 0046 — marking a lead as dealt with.
--
-- THE PROBLEM. A number that texts and never signs up shows in a yellow banner
-- on the conversations screen. That banner was permanent: it counted every such
-- number ever, so once anybody had texted once it never went away, and a
-- warning that is always on is one nobody reads. It also could not tell a lead
-- somebody had already called back from one nobody had touched.
--
-- WHY A TABLE. Everywhere else, "dealt with" hangs off a row that already
-- exists - an order, an issue, a customer. This one has nothing: a person who
-- texted and never signed up has no customer row by definition. That is the
-- whole point of the screen, so the only thing to key on is their number.
--
-- IT IS A TIMESTAMP, NOT A FLAG, AND THAT IS THE INTERESTING PART. Dismissing
-- says "I have dealt with everything they have said SO FAR". If they text
-- again afterwards, their new message is newer than the dismissal and they come
-- straight back into the banner - which is right, because somebody texting a
-- second time after being ignored is a better lead than the first time, not a
-- worse one. A boolean would have buried them for good.
--
-- Nothing here touches the messages themselves. Their whole thread is still
-- readable and their number is still on the conversations list; the only thing
-- that changes is whether they are being counted as needing attention.
-- ---------------------------------------------------------------------------

create table if not exists dismissed_leads (
  -- E.164, the same normalised form the messages table stores. One row per
  -- number: dismissing twice updates rather than stacking up history nobody
  -- would ever read.
  phone         text primary key,

  dismissed_at  timestamptz not null default now(),

  -- Who decided. Null if it was done with the machine key, which has no person
  -- attached, exactly like issues.resolved_by.
  dismissed_by  uuid references ops_users(id) on delete set null,

  -- Optional. "Called them, not interested" is worth more than a date on its
  -- own when somebody looks at this in three months.
  note          text
);

-- Same rule as every other table: RLS on, no policies, so the public anon key
-- can reach nothing. The server uses the service_role key, which bypasses it.
alter table dismissed_leads enable row level security;

comment on table dismissed_leads is
  'Numbers that texted without signing up and have been dealt with. Keyed on '
  'the number because a non-customer has no row anywhere else. dismissed_at is '
  'a timestamp rather than a flag on purpose: a lead who texts again after '
  'being dismissed comes back, because a second attempt is a better lead than '
  'the first, not a worse one.';
