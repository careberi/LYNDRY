-- Durable assignment intent and attempt state. No browser/anon access.
create table public.shipday_dispatch_settings (
  id boolean primary key default true check(id),
  enabled boolean not null default true,
  starts_at timestamptz not null default now()
);
insert into public.shipday_dispatch_settings(id) values(true);
alter table public.shipday_dispatch_settings enable row level security;
create table public.shipday_dispatch_plans (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  leg text not null check(leg in ('TO_PARTNER','TO_CUSTOMER')),
  dispatch_at timestamptz not null,
  mode text not null default 'THIRD_PARTY' check(mode in ('THIRD_PARTY','IN_HOUSE')),
  driver_id text,
  state text not null default 'PLANNED' check(state in ('PLANNED','PROCESSING','BLOCKED','ASSIGNED','REVIEW')),
  version integer not null default 0,
  shipday_order_id text,
  assigned_name text,
  tracking_url text,
  problem text,
  simulation boolean not null,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique(order_id,leg)
);
alter table public.shipday_dispatch_plans enable row level security;
create index shipday_dispatch_due on public.shipday_dispatch_plans(dispatch_at) where state in ('PLANNED','BLOCKED');
