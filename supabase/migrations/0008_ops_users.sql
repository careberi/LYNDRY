-- 0008_ops_users.sql
--
-- Who can sign in to /ops, and the one-time codes they sign in with.
--
-- Replaces a single shared code with a person per phone number. That matters
-- for two reasons: a driver who leaves can be switched off without changing a
-- secret everyone else is using, and every sign-in now belongs to somebody.
--
-- ADMIN_API_KEY does not go away — it stays as the machine credential for the
-- driver script and anything else calling the /ops JSON API.

create table if not exists ops_users (
  id uuid primary key default gen_random_uuid(),

  -- Stored the same way customer phones are: +1 then ten digits. One format
  -- everywhere, so a number typed on a form matches a number in the database.
  phone text not null unique,

  name text not null,

  -- DISABLED keeps the row — and therefore the history of who did what —
  -- while refusing every future sign-in. Deleting people loses that.
  status text not null default 'ACTIVE',

  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ops_users_status_check') then
    alter table ops_users add constraint ops_users_status_check
      check (status in ('ACTIVE', 'DISABLED'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The one-time codes
-- ---------------------------------------------------------------------------
--
-- THE CODE ITSELF IS NEVER STORED. What is stored is an HMAC of it, keyed with
-- ADMIN_API_KEY, so anyone reading this table cannot sign in with what they
-- find. Six digits is small enough to brute-force offline, which is exactly
-- why the plaintext never lands here and why `attempts` kills a code after a
-- handful of guesses.

create table if not exists ops_login_codes (
  id uuid primary key default gen_random_uuid(),

  ops_user_id uuid not null references ops_users (id) on delete cascade,

  code_hash text not null,

  -- Short. A code sitting valid for an hour is a code someone can find on a
  -- lock screen long after it was needed.
  expires_at timestamptz not null,

  -- Wrong guesses. Past a small number the code is dead even if it hasn't
  -- expired, which is what stops someone working through all million.
  attempts integer not null default 0,

  -- Set the moment it is used. A code works exactly once.
  consumed_at timestamptz,

  -- Who asked for it, for the same reason sms_consent_ip exists: it is the
  -- only evidence of origin if this is ever abused.
  requested_ip text,

  created_at timestamptz not null default now()
);

create index if not exists ops_login_codes_user_idx on ops_login_codes (ops_user_id, created_at desc);

-- Row level security on, no policies — the same as every other table here.
-- That denies all access through Supabase's public anon key. The server holds
-- the service_role key, which bypasses RLS entirely.
alter table ops_users enable row level security;
alter table ops_login_codes enable row level security;
