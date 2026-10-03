-- Retain suppression used by existing development manual-completion policy.
alter table public.orders add column if not exists delivery_notifications_suppressed boolean not null default false;

-- Development service-role completion. Provider verification is read only.
create or replace function public.complete_verified_dev_delivery(
 p_order uuid,p_plan uuid,p_version integer,p_remote text,p_driver text,p_photo text,p_checked timestamptz,p_expected jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare o orders%rowtype; p shipday_dispatch_plans%rowtype; was_delivered boolean;
begin
 select * into o from orders where id=p_order for update;
 if not found or o.dev_quote_id is null then raise exception 'Development quoted order required'; end if;
 if o.status not in ('OUT_FOR_DELIVERY','DELIVERED') or o.payment_status not in ('PAID','WAIVED') then raise exception 'Order state or payment changed'; end if;
 if o.status='DELIVERED' and o.delivery_notifications_suppressed then return jsonb_build_object('ok',true,'already',true); end if;
 if p_photo is null or p_photo not like o.id::text || '/recovery-%.jpg' then raise exception 'Verified delivery proof required'; end if;
 if p_checked is null or p_checked<now()-interval '30 seconds' or p_checked>now()+interval '5 seconds' then raise exception 'Delivery evidence expired'; end if;
 if p_expected->'partner_id' is distinct from to_jsonb(o.partner_id) or p_expected->'customer_id' is distinct from to_jsonb(o.customer_id) or p_expected->'preferences' is distinct from coalesce(o.preferences,'null'::jsonb) then raise exception 'Order details changed'; end if;
 perform 1 from customers c,partners s where c.id=o.customer_id and s.id=o.partner_id and s.status='ACTIVE' and to_jsonb(c)=p_expected->'customer' and to_jsonb(s)=p_expected->'shop' for share of c,s;
 if not found then raise exception 'Delivery endpoints changed'; end if;
 select * into p from shipday_dispatch_plans where id=p_plan and order_id=p_order and leg='TO_CUSTOMER' and mode='IN_HOUSE' and not simulation and version=p_version and shipday_order_id=p_remote and driver_id=p_driver and state in ('ASSIGNED','REVIEW','COMPLETED') for update;
 if not found or p.external_reference is distinct from 'LYNDRY-DEV-'||o.order_number||'-RETURN' or p.external_reference is distinct from p_expected->>'external_reference' then raise exception 'Return assignment changed'; end if;
 perform 1 from partner_order_intakes where order_id=o.id and partner_id=o.partner_id and received_verified_at is not null and completed_at is not null and collected_at is not null for share;
 if not found or not partner_return_weight_allowed(o.id) then raise exception 'Verified shop handoff and released weight required'; end if;
 was_delivered:=o.status='DELIVERED';
 if not was_delivered then
  update orders set status='DELIVERED',delivered_at=coalesce(delivered_at,now()),delivery_photo_path=p_photo,arrived_at=null,navigating_at=null where id=o.id;
  insert into order_events(order_id,kind,actor,summary,was,became,reason) values(o.id,'STATUS','system','Delivery completed from verified Shipday proof',o.status,'DELIVERED','Automatic reconciliation of the original linked return');
 end if;
 if p.state<>'COMPLETED' then
  update shipday_dispatch_plans set state='COMPLETED',problem=null,version=version+1,updated_at=now(),history=coalesce(history,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('event','RETURN_DELIVERED_VERIFIED','actor','system','at',now(),'remote',p_remote)) where id=p.id;
 end if;
 return jsonb_build_object('ok',true,'already',was_delivered);
end;$$;
revoke all on function public.complete_verified_dev_delivery(uuid,uuid,integer,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.complete_verified_dev_delivery(uuid,uuid,integer,text,text,text,timestamptz,jsonb) to service_role;

-- Persist the weight used by the existing frozen quote calculation. No repricing.
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
  update orders set price_cents=total,partner_weight_lb=p_weight,weight_lb=p_weight,partner_weight_at=now(),billable_weight_lb=p_weight where id=p_order;
  return jsonb_build_object('price_cents',total);
end $$;
revoke all on function record_dev_order_weight(uuid,numeric,jsonb) from public,anon,authenticated;
grant execute on function record_dev_order_weight(uuid,numeric,jsonb) to service_role;
