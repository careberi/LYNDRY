-- Routing changes propose new terms; customer approval remains required.
create function change_dev_order_partner(p_order uuid,p_partner uuid,p_snapshot jsonb,p_admin uuid,p_limit integer)
returns void language plpgsql security invoker set search_path=public as $$
declare o orders; c order_spending_controls; who text; shop text;
begin
 select name into who from ops_users where id=p_admin and role='ADMIN' and status='ACTIVE';
 if who is null then raise exception 'Administrator access required'; end if;
 select * into strict o from orders where id=p_order for update;
 if o.dev_quote_id is null or o.partner_id is not null or o.status not in ('REQUESTED','IN_PROCESS') or o.payment_status='PAID' then raise exception 'Order cannot change laundromat'; end if;
 select name into shop from partners where id=p_partner and type='LAUNDROMAT' and status='ACTIVE';
 if shop is null or p_snapshot->>'partnerId' is distinct from p_partner::text or (p_snapshot->>'expiresAt')::timestamptz <= now() or p_snapshot->>'expiresAt' is null then raise exception 'Refresh the laundromat quote'; end if;
 c:=propose_order_spending(p_order,(p_snapshot->>'estimatedReferenceTotalCents')::integer,p_limit,(p_snapshot->>'pickupCents')::integer,(p_snapshot->>'returnCents')::integer,'Approve revised pricing for '||shop,who);
 update orders set intended_partner_id=p_partner,partner_pinned_at=now(),partner_pinned_by=p_admin,
 pending_pricing_snapshot=p_snapshot||jsonb_build_object('revision',c.revision,'proposalKind','PARTNER_CHANGE','finalTotalCents',c.estimated_total_cents) where id=p_order;
 insert into order_events(order_id,kind,summary,actor) values(p_order,'NOTE','Destination changed to '||shop||'; revised pricing awaits customer approval',who);
end $$;
revoke all on function change_dev_order_partner(uuid,uuid,jsonb,uuid,integer) from public,anon,authenticated;
grant execute on function change_dev_order_partner(uuid,uuid,jsonb,uuid,integer) to service_role;

create or replace function apply_revised_dev_price() returns trigger language plpgsql security invoker set search_path=public as $$
declare p jsonb; o orders;
begin
 if old.pending and not new.pending then
  select * into o from orders where id=new.order_id for update;
  p:=o.pending_pricing_snapshot;
  if p is not null then
   if p->>'revision' is distinct from new.revision::text or (p->>'finalTotalCents')::integer is distinct from new.estimated_total_cents then raise exception 'Revised pricing no longer matches this approval'; end if;
   if p->>'proposalKind'='PARTNER_CHANGE' then
    if o.status not in ('REQUESTED','IN_PROCESS') or o.partner_id is not null or p->>'partnerId' is distinct from o.intended_partner_id::text then raise exception 'The destination changed; request a new approval'; end if;
    update orders set pricing_snapshot=p,pending_pricing_snapshot=null,price_per_lb_cents=(p->>'rateCentsPerLb')::integer,minimum_cents=(p->>'minimumTotalCents')::integer where id=new.order_id;
   else
    if (p->>'actualWeightLb')::numeric is null then raise exception 'Revised weight is missing'; end if;
    update orders set pricing_snapshot=p,pending_pricing_snapshot=null,
      price_per_lb_cents=(p->>'rateCentsPerLb')::integer,minimum_cents=(p->>'minimumTotalCents')::integer,
      weight_lb=(p->>'actualWeightLb')::numeric,partner_weight_lb=(p->>'actualWeightLb')::numeric,partner_weight_at=now(),price_cents=(p->>'finalTotalCents')::integer where id=new.order_id;
   end if;
  end if;
 end if;
 return new;
end $$;
