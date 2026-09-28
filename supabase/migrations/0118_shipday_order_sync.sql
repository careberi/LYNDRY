-- Delivery edits are durable even when they originate outside the order page.
create table public.shipday_order_sync (
  plan_id uuid primary key references public.shipday_dispatch_plans(id) on delete cascade,
  revision integer not null default 1,
  processing_revision integer,
  synced_revision integer not null default 0,
  state text not null default 'PENDING' check(state in ('PENDING','PROCESSING','SYNCED','REVIEW')),
  problem text,
  updated_at timestamptz not null default now(),
  synced_at timestamptz
);
alter table public.shipday_order_sync enable row level security;

create function public.queue_shipday_order_sync(p_order uuid) returns void
language sql security definer set search_path=public as $$
  insert into shipday_order_sync(plan_id)
  select id from shipday_dispatch_plans where order_id=p_order and shipday_order_id ~ '^[1-9][0-9]*$'
  on conflict(plan_id) do update set revision=shipday_order_sync.revision+1,
    state=case when shipday_order_sync.state='PROCESSING' then 'PROCESSING' else 'PENDING' end,
    problem=null,updated_at=now();
$$;

create function public.shipday_delivery_edit_trigger() returns trigger
language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
 if tg_table_name='orders' then
   perform queue_shipday_order_sync(new.id);
 elsif tg_table_name='customers' then
   for target in select id from orders where customer_id=new.id and status not in ('CANCELED','DELIVERED') loop
     perform queue_shipday_order_sync(target);
   end loop;
 elsif tg_table_name='partners' then
   for target in select id from orders where (partner_id=new.id or intended_partner_id=new.id) and status not in ('CANCELED','DELIVERED') loop
     perform queue_shipday_order_sync(target);
   end loop;
 else
   perform queue_shipday_order_sync(new.order_id);
 end if;
 return new;
end;
$$;
create trigger shipday_order_details_changed after update on public.orders for each row
when ((old.intended_partner_id,old.partner_id,old.pickup_date,old.pickup_time,old.pickup_method,old.preferences,old.customer_id,old.status)
 is distinct from (new.intended_partner_id,new.partner_id,new.pickup_date,new.pickup_time,new.pickup_method,new.preferences,new.customer_id,new.status))
execute function public.shipday_delivery_edit_trigger();
create trigger shipday_customer_details_changed after update on public.customers for each row
when ((old.name,old.phone,old.address_line1,old.address_line2,old.city,old.state,old.postal_code,old.lat,old.lng,old.preferences)
 is distinct from (new.name,new.phone,new.address_line1,new.address_line2,new.city,new.state,new.postal_code,new.lat,new.lng,new.preferences))
execute function public.shipday_delivery_edit_trigger();
create trigger shipday_partner_details_changed after update on public.partners for each row
when ((old.name,old.address_line1,old.address_line2,old.city,old.state,old.postal_code,old.lat,old.lng,old.status)
 is distinct from (new.name,new.address_line1,new.address_line2,new.city,new.state,new.postal_code,new.lat,new.lng,new.status))
execute function public.shipday_delivery_edit_trigger();
create trigger shipday_plan_linked after insert or update of shipday_order_id on public.shipday_dispatch_plans
for each row execute function public.shipday_delivery_edit_trigger();

create function public.finish_shipday_order_sync(p_plan uuid,p_revision integer,p_problem text default null) returns void
language sql security definer set search_path=public as $$
 update shipday_order_sync set
 state=case when p_problem is not null then 'REVIEW' when revision>p_revision then 'PENDING' else 'SYNCED' end,
 synced_revision=case when p_problem is null then p_revision else synced_revision end,
 synced_at=case when p_problem is null then now() else synced_at end,
 processing_revision=null,problem=p_problem,updated_at=now()
 where plan_id=p_plan and processing_revision=p_revision and state='PROCESSING';
$$;
revoke all on function public.queue_shipday_order_sync(uuid),public.shipday_delivery_edit_trigger(),public.finish_shipday_order_sync(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.queue_shipday_order_sync(uuid),public.finish_shipday_order_sync(uuid,integer,text) to service_role;
