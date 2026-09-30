-- Durable, shared notification claims prevent local and hosted workers from
-- sending the same delivery milestone. No existing orders or messages changed.
create table public.delivery_sms_state (
  order_id uuid references public.orders(id) on delete cascade,
  leg text check (leg in ('TO_PARTNER','TO_CUSTOMER')),
  rank integer not null default 0 check (rank between 0 and 3),
  version integer not null default 0,
  last_eta_at timestamptz,
  last_message_at timestamptz,
  primary key(order_id,leg)
);
create table public.delivery_sms_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  leg text not null check (leg in ('TO_PARTNER','TO_CUSTOMER')),
  event_key text not null,
  rank integer not null check (rank between 1 and 3),
  body text not null,
  remote_id text not null,
  state text not null default 'PENDING' check (state in ('PENDING','SENDING','SENT','SIMULATED','SKIPPED','REVIEW')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  problem text,
  unique(order_id,leg,event_key)
);
alter table public.delivery_sms_state enable row level security;
alter table public.delivery_sms_outbox enable row level security;
revoke all on public.delivery_sms_state,public.delivery_sms_outbox from anon,authenticated;
grant all on public.delivery_sms_state,public.delivery_sms_outbox to service_role;

create function public.queue_delivery_sms(p_order uuid,p_leg text,p_version integer,p_rank integer,p_key text,p_body text,p_remote text,p_eta timestamptz)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  update delivery_sms_state set rank=p_rank,version=version+1,last_eta_at=p_eta,last_message_at=now()
    where order_id=p_order and leg=p_leg and version=p_version and rank<=p_rank;
  if not found then return false; end if;
  insert into delivery_sms_outbox(order_id,leg,event_key,rank,body,remote_id)
    values(p_order,p_leg,p_key,p_rank,p_body,p_remote);
  return true;
end;
$$;
revoke all on function public.queue_delivery_sms(uuid,text,integer,integer,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.queue_delivery_sms(uuid,text,integer,integer,text,text,text,timestamptz) to service_role;
create index delivery_sms_pending on public.delivery_sms_outbox(created_at) where state in ('PENDING','SENDING');
