-- Neil retired the separate approval workflow. Preserve its historical records.
drop trigger if exists apply_revised_dev_price on order_spending_controls;
alter table order_spending_controls add column retired_at timestamptz,
  add column retired_pricing_snapshot jsonb;
update order_spending_controls c set retired_at=now(),
  retired_pricing_snapshot=o.pending_pricing_snapshot, pending=false
from orders o where o.id=c.order_id;

-- No consent is fabricated and no final bill or weight is invented during retirement.
-- Keep effective prices; proposed changes remain available in the archived record.
update orders set pending_pricing_snapshot=null where pending_pricing_snapshot is not null;

create or replace function record_dev_order_approval() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if new.dev_quote_id is not null then
    update dev_order_quotes set order_id=new.id where id=new.dev_quote_id;
  end if;
  return new;
end $$;

create or replace function propose_order_spending(p_order uuid,p_estimate integer,p_limit integer,p_pickup integer,p_return integer,p_reason text,p_actor text)
returns order_spending_controls language plpgsql security invoker set search_path=public as $$
begin raise exception 'Spending approvals have been retired'; end $$;
create or replace function approve_order_spending(p_order uuid,p_customer uuid,p_revision uuid)
returns order_spending_controls language plpgsql security invoker set search_path=public as $$
begin raise exception 'Spending approvals have been retired'; end $$;
create or replace function propose_dev_repricing(p_order uuid,p_snapshot jsonb,p_weight numeric,p_total integer,p_limit integer)
returns order_spending_controls language plpgsql security invoker set search_path=public as $$
begin raise exception 'Spending approvals have been retired'; end $$;

-- The legacy limit argument is ignored for compatibility with stale callers.
create or replace function change_dev_order_partner(p_order uuid,p_partner uuid,p_snapshot jsonb,p_admin uuid,p_limit integer)
returns void language plpgsql security invoker set search_path=public as $$
declare o orders; who text; shop text; rate integer; fee integer; minimum integer; actual numeric; snapshot jsonb;
begin
  select name into who from ops_users where id=p_admin and role='ADMIN' and status='ACTIVE';
  if who is null then raise exception 'Administrator access required'; end if;
  select * into strict o from orders where id=p_order for update;
  if o.dev_quote_id is null or o.partner_id is not null or o.status not in ('REQUESTED','IN_PROCESS') or o.payment_status='PAID' then raise exception 'Order cannot change laundromat'; end if;
  select name into shop from partners where id=p_partner and type='LAUNDROMAT' and status='ACTIVE';
  if shop is null or p_snapshot->>'partnerId' is distinct from p_partner::text or p_snapshot->>'expiresAt' is null or (p_snapshot->>'expiresAt')::timestamptz <= now() then raise exception 'Refresh the laundromat quote'; end if;
  rate:=(p_snapshot->>'rateCentsPerLb')::integer;
  fee:=(p_snapshot->>'operationalFeeCents')::integer;
  minimum:=(p_snapshot->>'minimumTotalCents')::integer;
  if rate is null or rate<=0 or fee is null or fee<0 or minimum is null or minimum<0
    or p_snapshot->'policy' is distinct from o.pricing_snapshot->'policy'
    or p_snapshot->>'category' is distinct from o.pricing_snapshot->>'category' then raise exception 'Invalid destination pricing'; end if;
  snapshot:=p_snapshot - array['revision','proposalKind','finalTotalCents','actualWeightLb'];
  actual:=coalesce(o.billable_weight_lb,o.partner_weight_lb,o.weight_lb);
  if actual is not null and (actual<=0 or actual>50 or actual='NaN'::numeric) then raise exception 'Resolve the order weight first'; end if;
  update orders set intended_partner_id=p_partner,partner_pinned_at=now(),partner_pinned_by=p_admin,
    pricing_snapshot=snapshot,pending_pricing_snapshot=null,price_per_lb_cents=rate,minimum_cents=minimum,
    price_cents=case when actual is null then null else greatest(minimum,ceil(actual*rate)::integer+fee) end
    where id=p_order;
  insert into order_events(order_id,kind,summary,actor)
    values(p_order,'NOTE','Destination changed to '||shop||'; order pricing updated',who);
end $$;

create function record_dev_order_weight(p_order uuid,p_weight numeric,p_expected_snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare o orders; rate integer; fee integer; minimum integer; total integer;
begin
  if p_weight is null or p_weight='NaN'::numeric or p_weight<=0 or p_weight>50 or round(p_weight,3)<>p_weight then raise exception 'Enter a valid order weight up to 50 lb'; end if;
  select * into strict o from orders where id=p_order for update;
  if o.dev_quote_id is null or o.pricing_snapshot is null or o.status<>'AT_PARTNER' then raise exception 'Only received development orders can be weighed'; end if;
  if p_expected_snapshot is distinct from o.pricing_snapshot then raise exception 'The order price changed. Refresh before weighing'; end if;
  if o.payment_status in ('PAID','WAIVED') then
    if coalesce(o.partner_weight_lb,o.weight_lb)=p_weight then return jsonb_build_object('price_cents',o.price_cents,'already',true); end if;
    raise exception 'A settled order cannot be reweighed';
  end if;
  rate:=(o.pricing_snapshot->>'rateCentsPerLb')::integer;
  fee:=(o.pricing_snapshot->>'operationalFeeCents')::integer;
  minimum:=(o.pricing_snapshot->>'minimumTotalCents')::integer;
  if rate is null or rate<=0 or fee is null or fee<0 or minimum is null or minimum<0 then raise exception 'Order pricing is incomplete'; end if;
  total:=greatest(minimum,ceil(p_weight*rate)::integer+fee);
  update orders set price_cents=total,partner_weight_lb=p_weight,weight_lb=p_weight,partner_weight_at=now() where id=p_order;
  return jsonb_build_object('price_cents',total);
end $$;
revoke all on function record_dev_order_weight(uuid,numeric,jsonb) from public,anon,authenticated;
grant execute on function record_dev_order_weight(uuid,numeric,jsonb) to service_role;

revoke execute on function propose_order_spending(uuid,integer,integer,integer,integer,text,text),
  approve_order_spending(uuid,uuid,uuid),propose_dev_repricing(uuid,jsonb,numeric,integer,integer)
  from public,anon,authenticated,service_role;
