-- Versioned weight-based prices. Existing accepted quotes remain unchanged.
create or replace function dev_weight_price(p_snapshot jsonb,p_weight numeric,p_apply_minimum boolean default true)
returns integer language plpgsql immutable security invoker set search_path=public as $$
declare p jsonb:=p_snapshot->'policy'; minimum integer; margin integer; percentage integer; fixed integer;
 wholesale integer; laundry_rate integer; pickup integer; return_cost integer; other_cost integer; other_weight integer;
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
 if p_snapshot->>'laundryPricingBasis' is not null then
   if p_snapshot->>'laundryPricingBasis' <> 'CUSTOMER_BASE_V1' then raise exception 'Unknown laundry pricing basis'; end if;
   laundry_rate:=(p_snapshot->>'customerBaseCentsPerLb')::integer;
   if coalesce(laundry_rate,0)<=0 then raise exception 'Invalid saved customer pricing base'; end if;
 else laundry_rate:=wholesale; end if;
 keep:=10000-margin-percentage;
 costs:=ceil(p_weight*laundry_rate)+pickup+return_cost+other_cost+ceil(p_weight*other_weight);
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

-- New quotes use the customer base. No accepted quotes or orders are rewritten.
insert into dev_pricing_policies(policy)
select policy || '{"laundryPricingBasis":"CUSTOMER_BASE_V1"}'::jsonb
from dev_pricing_policies where effective_at<=now() order by effective_at desc limit 1;
