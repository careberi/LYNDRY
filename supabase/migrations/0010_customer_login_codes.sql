-- 0010_customer_login_codes.sql
--
-- One-time codes for customers signing in to book on the website.
--
-- Same shape as ops_login_codes, and deliberately a separate table rather than
-- one shared one with a "kind" column. The two audiences have different rules
-- — staff have roles, customers have consent records and a card — and joining
-- them would mean every query carrying a filter that is easy to forget once.
--
-- THE CODE ITSELF IS NEVER STORED, exactly as with staff: what is kept is an
-- HMAC keyed with ADMIN_API_KEY. Six digits is small enough to brute-force
-- offline, which is why the plaintext must not sit in a row.

create table if not exists customer_login_codes (
  id uuid primary key default gen_random_uuid(),

  customer_id uuid not null references customers (id) on delete cascade,

  code_hash text not null,

  expires_at timestamptz not null,

  -- Wrong guesses. Past a handful the code is dead even if it hasn't expired.
  attempts integer not null default 0,

  -- Set the moment it is used. A code works exactly once.
  consumed_at timestamptz,

  requested_ip text,

  created_at timestamptz not null default now()
);

create index if not exists customer_login_codes_customer_idx
  on customer_login_codes (customer_id, created_at desc);

-- Row level security on, no policies — the same as every other table here.
alter table customer_login_codes enable row level security;
