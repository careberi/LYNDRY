-- People outside the current laundromat coverage can ask to hear when it expands.
-- This is deliberately separate from customers: no order can be booked for them,
-- no promotion is granted, and submitting the form sends no immediate marketing text.
create table if not exists public.service_area_interests (
  interest_key   text primary key,
  phone          text not null,
  address_text   text not null,
  address_line1  text,
  address_line2  text,
  city           text,
  state          text not null default 'NJ',
  postal_code    text,
  lat            double precision,
  lng            double precision,
  consent_source text not null default 'WEB_QUOTE' check (consent_source = 'WEB_QUOTE'),
  consent_ip     inet,
  created_at     timestamptz not null default now(),
  consented_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  notified_at    timestamptz
);

create index if not exists service_area_interests_unnotified_idx
  on public.service_area_interests (created_at)
  where notified_at is null;

alter table public.service_area_interests enable row level security;

comment on table public.service_area_interests is
  'Consented launch-notification requests from public dynamic-pricing lookups outside current laundromat coverage.';
