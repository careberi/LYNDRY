-- Washing is a saved step; it never creates a return assignment.
alter table public.partner_order_intakes
  add column wash_completed_at timestamptz,
  add column wash_completed_by uuid references public.partner_users(id),
  add column wash_completed_by_admin uuid references public.ops_users(id);
-- Already-ready orders have completed washing; do not reset their return workflow.
update public.partner_order_intakes set wash_completed_at=ready_at,
  wash_completed_by=ready_by, wash_completed_by_admin=ready_by_admin where ready_at is not null;

create or replace function public.partner_return_weight_allowed(p_order uuid)
returns boolean language sql stable security invoker set search_path=public as $$
  select not exists(select 1 from partner_order_intakes where order_id=p_order and (return_check_status='HELD' or wash_completed_at is null))
    and (not exists(select 1 from laundromat_workflow_settings where weight_tolerance_lb is not null)
      or exists(select 1 from partner_order_intakes where order_id=p_order and return_check_status in ('PASSED','RELEASED')));
$$;

create or replace function public.record_partner_intake_as(
  p_order uuid, p_partner uuid, p_actor uuid, p_is_admin boolean, p_action text,
  p_tracking text default null, p_weight numeric default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  o orders%rowtype;
  i partner_order_intakes%rowtype;
  who text;
  tolerance numeric;
  checked partner_delivery_checks%rowtype;
begin
  if p_is_admin then
    select u.name || ' (LYNDRY admin) at ' || p.name into who from ops_users u
      cross join partners p where u.id=p_actor and u.status='ACTIVE' and u.role='ADMIN'
      and p.id=p_partner and p.status='ACTIVE' and p.type='LAUNDROMAT';
  else
    select u.name || ' at ' || p.name into who from partner_users u join partners p on p.id=u.partner_id
      where u.id=p_actor and u.partner_id=p_partner and u.status='ACTIVE' and p.status='ACTIVE' and p.type='LAUNDROMAT';
  end if;
  if who is null then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  -- Serializes receipt/intake changes within one shop.
  perform pg_advisory_xact_lock(hashtextextended(p_partner::text, 0));
  select * into o from orders where id = p_order
    and coalesce(partner_id,intended_partner_id) = p_partner for update;
  if not found or o.status not in ('REQUESTED','IN_PROCESS','AT_PARTNER','READY') then
    return jsonb_build_object('ok',false,'reason','unavailable');
  end if;
  select * into i from partner_order_intakes where order_id = p_order;
  if i.order_id is not null and i.partner_id<>p_partner and (i.received_verified_at is not null or i.completed_at is not null) then
    return jsonb_build_object('ok',false,'reason','unavailable');
  end if;
  if p_action = 'intake' then
    if length(coalesce(p_tracking,''))>64 or coalesce(p_tracking,'') ~ '[[:cntrl:]]' then return jsonb_build_object('ok',false,'reason','invalid_reference'); end if;
    if p_weight is null or p_weight::text in ('NaN','Infinity','-Infinity') or p_weight<=0 or p_weight>50 or p_weight<>round(p_weight,2) then
      return jsonb_build_object('ok',false,'reason','invalid_intake');
    end if;
    if i.completed_at is not null then
      return jsonb_build_object('ok',i.weight_lb=p_weight,'already',true,'reason','already_saved');
    end if;
    select c.* into checked from partner_delivery_checks c join shipday_dispatch_plans p on p.id=c.plan_id
      join partners shop on shop.id=p_partner
      where c.order_id=p_order and c.partner_id=p_partner and c.eligible
      and c.checked_at >= now()-interval '30 seconds' and c.checked_at <= now()+interval '5 seconds'
      and c.provider_status in ('PICKED_UP','READY_TO_DELIVER','ALREADY_DELIVERED')
      and p.order_id=p_order and p.leg='TO_PARTNER' and not p.simulation and p.shipday_order_id=c.shipday_order_id
      and c.pickup_date=o.pickup_date and c.pickup_time is not distinct from o.pickup_time
      and o.pickup_date <= (now() at time zone 'America/New_York')::date
      and c.destination=jsonb_build_object('name',shop.name,'address_line1',shop.address_line1,'address_line2',shop.address_line2,'city',shop.city,'state',shop.state,'postal_code',shop.postal_code);
    if not found then return jsonb_build_object('ok',false,'reason','delivery_unverified'); end if;
    insert into partner_order_intakes(order_id,partner_id,received_by,received_by_admin,received_verified_at,received_shipday_order_id,received_shipday_status)
    values(p_order,p_partner,case when not p_is_admin then p_actor end,case when p_is_admin then p_actor end,checked.checked_at,checked.shipday_order_id,checked.provider_status)
    on conflict(order_id) do update set partner_id=excluded.partner_id,received_at=now(),received_by=excluded.received_by,received_by_admin=excluded.received_by_admin,
      received_verified_at=excluded.received_verified_at,received_shipday_order_id=excluded.received_shipday_order_id,received_shipday_status=excluded.received_shipday_status;
    update orders set partner_id = p_partner, status = case when status = 'READY' then status else 'AT_PARTNER' end,
      at_partner_at = coalesce(at_partner_at,now()) where id = p_order;
    update partner_order_intakes set shop_reference=nullif(btrim(p_tracking),''), weight_lb = p_weight,
      completed_at = now(), completed_by = case when not p_is_admin then p_actor end, completed_by_admin = case when p_is_admin then p_actor end where order_id = p_order;
    update orders set partner_weight_lb = p_weight, partner_weight_at = now() where id = p_order;
    insert into order_events(order_id,kind,summary,actor) values
      (p_order,'PARTNER_WEIGHT','Delivery received and intake saved: full-order weight ' || p_weight || ' lb',who);
  elsif p_action = 'wash-complete' then
    if i.completed_at is null or i.received_verified_at is null then return jsonb_build_object('ok',false,'reason','intake_first'); end if;
    if i.wash_completed_at is not null then return jsonb_build_object('ok',true,'already',true); end if;
    if o.status <> 'AT_PARTNER' then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
    update partner_order_intakes set wash_completed_at=now(),
      wash_completed_by=case when not p_is_admin then p_actor end,
      wash_completed_by_admin=case when p_is_admin then p_actor end where order_id=p_order;
    insert into order_events(order_id,kind,summary,actor) values(p_order,'PARTNER','Laundromat marked washing and packing complete',who);
  elsif p_action = 'ready' then
    if i.wash_completed_at is null then return jsonb_build_object('ok',false,'reason','wash_complete_first'); end if;
    if i.completed_at is null or i.received_verified_at is null then return jsonb_build_object('ok',false,'reason','intake_first'); end if;

    select weight_tolerance_lb into tolerance from laundromat_workflow_settings where id;
    if tolerance is not null then
      if i.return_check_status='HELD' then return jsonb_build_object('ok',false,'reason','return_weight_held'); end if;
      if i.return_check_status not in ('PASSED','RELEASED') then
        if p_weight is null or p_weight::text in ('NaN','Infinity','-Infinity') or p_weight<=0 or p_weight>50 or p_weight<>round(p_weight,2) then
          return jsonb_build_object('ok',false,'reason','return_weight_required');
        end if;
        update partner_order_intakes set return_weight_lb=p_weight,return_checked_at=now(),return_tolerance_lb=tolerance,
          return_check_status=case when abs(weight_lb-p_weight)<=tolerance then 'PASSED' else 'HELD' end where order_id=p_order;
        if abs(i.weight_lb-p_weight)>tolerance then
          insert into issues(customer_id,order_id,reason) values(o.customer_id,p_order,'Order #'||o.order_number||': return weight mismatch. Review the laundromat return hold.')
            on conflict(customer_id) where status='OPEN' do update set reason=issues.reason||E'\nOrder #'||o.order_number||': return weight mismatch. Review the laundromat return hold.';
          insert into order_events(order_id,kind,summary,actor) values
            (p_order,'PARTNER_WEIGHT','Return blocked: intake '||i.weight_lb||' lb, return '||p_weight||' lb, tolerance '||tolerance||' lb',who);
          return jsonb_build_object('ok',false,'reason','return_weight_held');
        end if;
        insert into order_events(order_id,kind,summary,actor) values(p_order,'PARTNER_WEIGHT','Return weight verified: '||p_weight||' lb',who);
      end if;
    end if;

    if i.ready_at is not null then return jsonb_build_object('ok',true,'already',true); end if;
    update partner_order_intakes set ready_at = now(), ready_by = case when not p_is_admin then p_actor end, ready_by_admin = case when p_is_admin then p_actor end where order_id = p_order;
    update orders set status = 'READY', ready_at = coalesce(ready_at,now()) where id = p_order;
    insert into order_events(order_id,kind,summary,actor) values
      (p_order,'PARTNER','Laundromat marked laundry ready for return',who);
  else
    return jsonb_build_object('ok',false,'reason','unavailable');
  end if;
  return jsonb_build_object('ok',true,'already',false);
end;
$$;

