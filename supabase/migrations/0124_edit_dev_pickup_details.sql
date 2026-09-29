-- Order-scoped edits and repricing commit together; never race a driver request.
create function edit_dev_pickup_details(p_order uuid,p_admin uuid,p_expected jsonb,p_date date,p_time time,p_preferences jsonb,p_snapshot jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare o orders; who text; rate integer; fee integer; minimum integer; destination uuid;
begin
 select name into who from ops_users where id=p_admin and role='ADMIN' and status='ACTIVE';
 if who is null then raise exception 'Administrator access required'; end if;
 select * into strict o from orders where id=p_order for update;
 if o.dev_quote_id is null or o.status<>'REQUESTED' or o.partner_id is not null or o.payment_status='PAID' then raise exception 'Only an uncollected development pickup can be edited'; end if;
 if jsonb_build_object('pickup_date',o.pickup_date,'pickup_time',o.pickup_time,'preferences',o.preferences,'pricing_snapshot',o.pricing_snapshot) is distinct from p_expected then raise exception 'Order changed. Refresh before editing'; end if;
 perform 1 from shipday_dispatch_plans where order_id=p_order for update;
 if exists(select 1 from shipday_dispatch_plans where order_id=p_order and (shipday_order_id is not null or state in ('PROCESSING','REQUESTED','ASSIGNED','REVIEW') or assignment_requested_at is not null))
 or exists(select 1 from courier_deliveries where order_id=p_order and delivery_id is not null) then raise exception 'A courier job already exists. Resolve it in Shipday before changing pickup details'; end if;
 if (p_date+p_time) at time zone 'America/New_York' <= now() then raise exception 'Choose a future pickup time'; end if;
 destination:=(p_snapshot->>'partnerId')::uuid;
 if p_snapshot->>'source' is distinct from 'SHIPDAY' or (p_snapshot->>'expiresAt')::timestamptz is null or (p_snapshot->>'expiresAt')::timestamptz<=now()
 or not exists(select 1 from partners where id=destination and status='ACTIVE') then raise exception 'Refresh the pickup quote'; end if;
 if p_snapshot->'policy' is distinct from o.pricing_snapshot->'policy' then raise exception 'Pricing policy changed. Refresh the order'; end if;
 if (o.pricing_snapshot->>'category'='WHOLESALE' or exists(select 1 from customers where id=o.customer_id and pricing_category='WHOLESALE')) and p_snapshot->>'category' is distinct from 'WHOLESALE' then raise exception 'Wholesale pricing must be preserved'; end if;
 rate:=(p_snapshot->>'rateCentsPerLb')::integer;fee:=(p_snapshot->>'operationalFeeCents')::integer;minimum:=(p_snapshot->>'minimumTotalCents')::integer;
 if rate is null or rate<=0 or fee is null or fee<0 or minimum is null or minimum<0 then raise exception 'Invalid pickup price'; end if;
 update orders set pickup_date=p_date,pickup_time=p_time,preferences=p_preferences,intended_partner_id=destination,pricing_snapshot=p_snapshot,pending_pricing_snapshot=null,price_per_lb_cents=rate,minimum_cents=minimum where id=p_order;
 update shipday_dispatch_plans set dispatch_at=(p_date+p_time) at time zone 'America/New_York',trip_snapshot=null,external_reference=null,state='PLANNED',problem=null,next_attempt_at=null,version=version+1 where order_id=p_order and leg='TO_PARTNER';
 insert into order_events(order_id,kind,summary,actor) values(p_order,'NOTE','Pickup address, schedule, service and wash instructions edited; pricing refreshed',who);
end $$;
revoke all on function edit_dev_pickup_details(uuid,uuid,jsonb,date,time,jsonb,jsonb) from public,anon,authenticated;
grant execute on function edit_dev_pickup_details(uuid,uuid,jsonb,date,time,jsonb,jsonb) to service_role;
