-- Fresh matching pickup evidence resolves an uncertain request for manual handoff only.
create or replace function public.confirm_partner_return_collection(
  p_order uuid,p_partner uuid,p_actor uuid,p_is_admin boolean,
  p_plan uuid,p_version integer,p_shipday text,p_driver text,p_status text,p_checked timestamptz,
  p_shop jsonb,p_customer jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare o orders%rowtype; i partner_order_intakes%rowtype; who text;
begin
  if p_is_admin then
    select u.name || ' (LYNDRY admin) at ' || p.name into who from ops_users u cross join partners p
      where u.id=p_actor and u.status='ACTIVE' and u.role='ADMIN' and p.id=p_partner and p.status='ACTIVE' and p.type='LAUNDROMAT';
  else
    select u.name || ' at ' || p.name into who from partner_users u join partners p on p.id=u.partner_id
      where u.id=p_actor and u.partner_id=p_partner and u.status='ACTIVE' and p.status='ACTIVE' and p.type='LAUNDROMAT';
  end if;
  if who is null then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_partner::text,0));
  select * into o from orders where id=p_order and partner_id=p_partner for update;
  if not found then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  select * into i from partner_order_intakes where order_id=p_order and partner_id=p_partner for update;
  if i.collected_at is not null then return jsonb_build_object('ok',true,'already',true); end if;
  if not partner_return_weight_allowed(p_order) then return jsonb_build_object('ok',false,'reason','return_weight_held'); end if;
  if o.status<>'READY' or o.payment_status not in ('PAID','WAIVED') or i.ready_at is null or i.completed_at is null or i.received_verified_at is null then
    return jsonb_build_object('ok',false,'reason','unavailable');
  end if;
  if p_status is null or p_status not in ('PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED') or p_checked is null
    or p_checked<now()-interval '30 seconds' or p_checked>now()+interval '5 seconds' then
    return jsonb_build_object('ok',false,'reason','return_not_collected');
  end if;
  -- Lock the assignment and endpoints so a different driver's evidence cannot
  -- commit during a concurrent reassignment or address edit.
  perform 1 from shipday_dispatch_plans where id=p_plan and order_id=p_order and leg='TO_CUSTOMER'
    and state in ('ASSIGNED','REVIEW','COMPLETED') and mode='IN_HOUSE' and not simulation and version=p_version
    and shipday_order_id=p_shipday and driver_id=p_driver for update;
  if not found then return jsonb_build_object('ok',false,'reason','return_not_collected'); end if;
  perform 1 from partners p,customers c where p.id=p_partner and c.id=o.customer_id
    and p_shop=jsonb_build_object('name',p.name,'address_line1',p.address_line1,'address_line2',p.address_line2,'city',p.city,'state',p.state,'postal_code',p.postal_code)
    and p_customer=jsonb_build_object('name',c.name,'address_line1',c.address_line1,'address_line2',c.address_line2,'city',c.city,'state',c.state,'postal_code',c.postal_code) for share of p,c;
  if not found then return jsonb_build_object('ok',false,'reason','delivery_mismatch'); end if;
  update partner_order_intakes set collected_at=now(),collected_by=case when not p_is_admin then p_actor end,
    collected_by_admin=case when p_is_admin then p_actor end where order_id=p_order;
  update orders set status='OUT_FOR_DELIVERY' where id=p_order;
  insert into order_events(order_id,kind,summary,actor) values
    (p_order,'PARTNER','Laundromat confirmed return collection by the assigned Shipday driver',who);
  return jsonb_build_object('ok',true,'already',false);
end;
$$;
revoke all on function public.confirm_partner_return_collection(uuid,uuid,uuid,boolean,uuid,integer,text,text,text,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_partner_return_collection(uuid,uuid,uuid,boolean,uuid,integer,text,text,text,timestamptz,jsonb,jsonb) to service_role;
