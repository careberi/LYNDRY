-- Keep proposed weight and price together, separate from approved order terms.
create or replace function propose_dev_repricing(p_order uuid,p_snapshot jsonb,p_weight numeric,p_total integer,p_limit integer)
returns order_spending_controls language plpgsql security invoker set search_path=public as $$
declare o orders; c order_spending_controls;
begin
  select * into strict o from orders where id=p_order for update;
  if o.dev_quote_id is null or o.status<>'AT_PARTNER' or o.payment_status='PAID' or p_weight is null or p_weight<=0 then raise exception 'Order cannot be repriced'; end if;
  c:=propose_order_spending(p_order,p_total,p_limit,(p_snapshot->>'pickupCents')::integer,(p_snapshot->>'returnCents')::integer,'Approve revised pricing after actual weight or cost changes','system:weigh-in');
  update orders set pending_pricing_snapshot=p_snapshot||jsonb_build_object('revision',c.revision,'actualWeightLb',p_weight) where id=p_order;
  return c;
end $$;

create or replace function apply_revised_dev_price() returns trigger language plpgsql security invoker set search_path=public as $$
declare p jsonb;
begin
  if old.pending and not new.pending then
    select pending_pricing_snapshot into p from orders where id=new.order_id for update;
    if p is not null then
      if p->>'revision' is distinct from new.revision::text or (p->>'finalTotalCents')::integer is distinct from new.estimated_total_cents or (p->>'actualWeightLb')::numeric is null then raise exception 'Revised pricing no longer matches this approval'; end if;
      update orders set pricing_snapshot=p,pending_pricing_snapshot=null,
        price_per_lb_cents=(p->>'rateCentsPerLb')::integer,minimum_cents=(p->>'minimumTotalCents')::integer,
        weight_lb=(p->>'actualWeightLb')::numeric,partner_weight_lb=(p->>'actualWeightLb')::numeric,partner_weight_at=now(),
        price_cents=(p->>'finalTotalCents')::integer where id=new.order_id;
    end if;
  end if;
  return new;
end $$;
