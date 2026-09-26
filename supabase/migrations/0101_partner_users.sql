-- 0101_partner_users.sql
--
-- WHO AT A LAUNDROMAT CAN SIGN IN, and the one-time codes they sign in with.
--
-- Neil's ask, 25 September: "I need an interface as to where the laundromat
-- attendant can log into and see the current orders at her store... they will
-- also need to enter the weight into the order of all the bags and then go back
-- into that order to tell uber to come get it."
--
-- THIS REVERSES "A PARTNER NEVER TOUCHES THE SYSTEM", which CLAUDE.md states
-- plainly and which was right under the van: the driver was physically at the
-- counter, so he could be the one between a weight and somebody's card. Under a
-- courier nobody from LYNDRY is ever in the building. The weight has to be
-- entered by whoever is holding the bag, and that is an attendant.
--
-- A PERSON PER PHONE NUMBER, NOT A SHARED PASSWORD FOR THE SHOP. The same
-- argument 0008 makes for ops_users, and it is stronger here: laundromat staff
-- turn over, and a shared code means changing it for everybody every time
-- somebody leaves. A row per attendant is switched off on its own and leaves the
-- record of who weighed what.
--
-- IT IS A THIRD SIGN-IN AND IT IS DELIBERATELY NOT EITHER OF THE OTHER TWO.
-- Staff sessions are signed with ADMIN_API_KEY and reach the books; customer
-- sessions reach one person's own orders. An attendant is neither, and the whole
-- point of separate modules is that one bug cannot hand out the wrong kind.

create table if not exists partner_users (
  id uuid primary key default gen_random_uuid(),

  -- WHICH SHOP THEY WORK AT. One partner per row: somebody working two
  -- laundromats gets two rows, which is honest, because they are two jobs and
  -- either can end on its own. It is also what scopes every query in the portal.
  partner_id uuid not null references partners (id) on delete cascade,

  -- Stored the same way every other phone here is: +1 then ten digits. One
  -- format everywhere, so a number typed on a form matches a number in the
  -- database - and so notify.js can refuse the fictional 555-01xx range.
  phone text not null unique,

  name text not null,

  -- DISABLED keeps the row, and therefore the history of who weighed which bag,
  -- while refusing every future sign-in. Deleting people loses that.
  status text not null default 'ACTIVE',

  -- ONE SIGNED-IN DEVICE PER PERSON, exactly as ops_users does it. A shop
  -- tablet and a personal phone cannot both be live, so an attendant who signs
  -- in at home has signed the counter out - which is the behaviour to want,
  -- because the counter is where the bags are.
  session_token text,
  session_started_at timestamptz,

  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'partner_users_status_check') then
    alter table partner_users add constraint partner_users_status_check
      check (status in ('ACTIVE', 'DISABLED'));
  end if;
end $$;

create index if not exists partner_users_partner_idx on partner_users (partner_id, status);

-- ---------------------------------------------------------------------------
-- The one-time codes
-- ---------------------------------------------------------------------------
--
-- THE CODE ITSELF IS NEVER STORED, for the reason 0008 gives: an HMAC keyed with
-- ADMIN_API_KEY, so anybody reading this table cannot sign in with what they
-- find. Six digits is small enough to brute-force offline, which is why the
-- plaintext never lands here and why `attempts` kills a code after a handful of
-- guesses whatever its expiry says.
--
-- A SEPARATE TABLE FROM ops_login_codes, not a nullable second column on it. A
-- code is a credential for one kind of principal, and one table with two
-- foreign keys is one query away from a code issued for an attendant being
-- accepted for a staff sign-in.

create table if not exists partner_login_codes (
  id uuid primary key default gen_random_uuid(),

  partner_user_id uuid not null references partner_users (id) on delete cascade,

  code_hash text not null,

  expires_at timestamptz not null,

  attempts integer not null default 0,

  consumed_at timestamptz,

  -- Who asked for it, the same evidence-of-origin reason sms_consent_ip exists.
  requested_ip text,

  created_at timestamptz not null default now()
);

create index if not exists partner_login_codes_user_idx
  on partner_login_codes (partner_user_id, created_at desc);

-- Row level security on, no policies - the same as every other table here. That
-- denies all access through Supabase's public anon key; the server holds the
-- service_role key, which bypasses RLS entirely.
alter table partner_users enable row level security;
alter table partner_login_codes enable row level security;
