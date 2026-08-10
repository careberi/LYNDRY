-- 0007_partner_enquiries.sql
--
-- People asking to work with us, from the /partners page.
--
-- Two kinds, and they want opposite things:
--
--   LAUNDROMAT  has machines and slack capacity, wants volume from us
--   PROPERTY    manages a building, wants LYNDRY offered to residents
--
-- One table rather than two, because the fields are the same and the only
-- thing that really differs is what the "size" question means. A text column
-- with a CHECK, not a Postgres enum, so adding a third kind later is a
-- one-line change.

create table if not exists partner_enquiries (
  id uuid primary key default gen_random_uuid(),

  partner_type text not null,

  -- Who they are.
  company text not null,
  contact_name text not null,
  email text not null,
  phone text,
  city text,

  -- Deliberately one free-text column rather than two typed ones. A
  -- laundromat answers it with machines or pounds a day, a property manager
  -- with a number of units. Forcing both into a number would lose the
  -- qualifier that makes the answer useful.
  size_note text,

  message text,

  -- NEW until Neil has replied. There is no admin UI, so this is read with a
  -- query — but it stops a follow-up being missed once there are more than a
  -- handful.
  status text not null default 'NEW',

  -- Recorded for the same reason as sms_consent_ip: it is the only evidence
  -- of where a submission actually came from if the form gets abused.
  source_ip text,

  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'partner_enquiries_type_check') then
    alter table partner_enquiries add constraint partner_enquiries_type_check
      check (partner_type in ('LAUNDROMAT', 'PROPERTY'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'partner_enquiries_status_check') then
    alter table partner_enquiries add constraint partner_enquiries_status_check
      check (status in ('NEW', 'CONTACTED', 'CLOSED'));
  end if;
end $$;

-- The two queries this table exists to answer: "who hasn't been replied to"
-- and "show me the laundromats".
create index if not exists partner_enquiries_status_idx on partner_enquiries (status, created_at desc);
create index if not exists partner_enquiries_type_idx on partner_enquiries (partner_type);

-- Row level security on, no policies — the same as every other table here.
-- That denies all access through Supabase's public anon key. The server holds
-- the service_role key, which bypasses RLS entirely.
alter table partner_enquiries enable row level security;
