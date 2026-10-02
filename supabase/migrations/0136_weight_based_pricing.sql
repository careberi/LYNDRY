-- Versioned weight-based prices. Existing accepted quotes remain unchanged.
create function dev_weight_price(p_snapshot jsonb,p_weight numeric,p_apply_minimum boolean default true)
returns integer language plpgsql immutable security invoker set search_path=public as $$
declare p jsonb:=p_snapshot->'policy'; minimum integer; margin integer; percentage integer; fixed integer;
 wholesale integer; pickup integer; return_cost integer; other_cost integer; other_weight integer;
 costs numeric; total numeric; keep integer; processing numeric; hold_amount numeric; shortfall numeric; n integer;
begin
 if p_weight is null or p_weight='NaN'::numeric or p_weight<=0 or p_weight>50 or round(p_weight,3)<>p_weight then raise exception 'Enter a valid order weight up to 50 lb'; end if;
 minimum:=(p_snapshot->>'minimumTotalCents')::integer;
 if p_snapshot->>'pricingMethod' is distinct from 'WEIGHT_BASED_MARGIN_V1' then
   return greatest(minimum,ceil(p_weight*(p_snapshot->>'rateCentsPerLb')::integer)::integer+(p_snapshot->>'operationalFeeCents')::integer);
 end if;
 margin:=(p->'marginBps'->>(p_snapshot->>'category'))::integer;
 percentage:=(p->>'processingBps')::integer; fixed:=(p->>'processingFixedCents')::integer;
 wholesale:=(p_snapshot->>'wholesaleCentsPerLb')::integer;
 pickup:=(p_snapshot->>'pickupCents')::integer; return_cost:=(p_snapshot->>'returnCents')::integer;
 other_cost:=coalesce((p->>'otherCostCents')::integer,0); other_weight:=coalesce((p->>'otherCostPerLbCents')::integer,0);
 if coalesce(minimum,-1)<0 or coalesce(margin,-1)<0 or coalesce(percentage,-1)<0 or margin+percentage>=10000
 or coalesce(fixed,-1)<0 or coalesce(wholesale,0)<=0 or coalesce(pickup,-1)<0 or coalesce(return_cost,-1)<0 or other_cost<0 or other_weight<0 then raise exception 'Incomplete saved weight pricing'; end if;
 keep:=10000-margin-percentage;
 costs:=ceil(p_weight*wholesale)+pickup+return_cost+other_cost+ceil(p_weight*other_weight);
 total:=greatest(case when p_apply_minimum then minimum else 0 end,ceil((costs+fixed)*10000/keep));
 if p->'cardHold' is not null and p->'cardHold'->>'mode' not in ('FIXED','MINIMUM','MAXIMUM') then raise exception 'Invalid saved card hold'; end if;
 for n in 1..10 loop
   hold_amount:=case p->'cardHold'->>'mode' when 'FIXED' then (p->'cardHold'->>'fixedCents')::integer when 'MINIMUM' then minimum else total end;
   if hold_amount>0 and total>hold_amount then
     processing:=round(hold_amount*percentage/10000)+round((total-hold_amount)*percentage/10000)+fixed*2;
   else processing:=round(total*percentage/10000)+fixed+case when p->'cardHold'->>'mode' in ('FIXED','MINIMUM') then fixed else 0 end; end if;
   shortfall:=total*margin-(total-costs-processing)*10000;
   if shortfall<=0 then return total::integer; end if;
   total:=total+greatest(1,ceil(shortfall/keep));
 end loop;
 raise exception 'Could not calculate a safe order total';
end $$;
revoke all on function dev_weight_price(jsonb,numeric,boolean) from public,anon,authenticated;
grant execute on function dev_weight_price(jsonb,numeric,boolean) to service_role;

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
    price_cents=case when actual is null then null else dev_weight_price(snapshot,actual) end
    where id=p_order;
  insert into order_events(order_id,kind,summary,actor)
    values(p_order,'NOTE','Destination changed to '||shop||'; order pricing updated',who);
end $$;

create or replace function record_dev_order_weight(p_order uuid,p_weight numeric,p_expected_snapshot jsonb)
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
  total:=dev_weight_price(o.pricing_snapshot,p_weight);
  update orders set price_cents=total,partner_weight_lb=p_weight,weight_lb=p_weight,partner_weight_at=now() where id=p_order;
  return jsonb_build_object('price_cents',total);
end $$;
revoke all on function record_dev_order_weight(uuid,numeric,jsonb) from public,anon,authenticated;
grant execute on function record_dev_order_weight(uuid,numeric,jsonb) to service_role;


-- New development policy only. No orders or accepted quotes are rewritten.
insert into dev_pricing_policies(policy)
select policy || '{"pricingMethod":"WEIGHT_BASED_MARGIN_V1","minimumTotalCents":2800,"otherCostCents":0,"otherCostPerLbCents":0,"marginBps":{"ONE_TIME":2000,"SUBSCRIPTION":1000,"WHOLESALE":500}}'::jsonb
from dev_pricing_policies where effective_at<=now() order by effective_at desc limit 1;
