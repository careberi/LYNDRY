-- LYNDRY admins use their own identities; shop ownership is unchanged.
alter table partner_order_intakes
  add column received_by_admin uuid references ops_users(id),
  add column completed_by_admin uuid references ops_users(id),
  add column ready_by_admin uuid references ops_users(id),
  alter column received_by drop not null,
  drop constraint partner_order_intakes_check;
alter table partner_order_intakes
  add constraint intake_received_actor check(num_nonnulls(received_by,received_by_admin)=1),
  add constraint intake_completed_actor check(
    (completed_at is null and tracking_number is null and weight_lb is null and completed_by is null and completed_by_admin is null)
    or (completed_at is not null and tracking_number is not null and length(btrim(tracking_number)) between 1 and 64
      and weight_lb > 0 and weight_lb <= 50 and num_nonnulls(completed_by,completed_by_admin)=1)),
  add constraint intake_ready_actor check((ready_at is null and ready_by is null and ready_by_admin is null)
    or (ready_at is not null and num_nonnulls(ready_by,ready_by_admin)=1));

create or replace function public.record_partner_intake_as(
  p_order uuid, p_partner uuid, p_actor uuid, p_is_admin boolean, p_action text,
  p_tracking text default null, p_weight numeric default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  o orders%rowtype;
  i partner_order_intakes%rowtype;
  who text;
  ticket text := btrim(p_tracking);
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
  -- Serializes ticket uniqueness checks within one shop, including other orders.
  perform pg_advisory_xact_lock(hashtextextended(p_partner::text, 0));
  select * into o from orders where id = p_order
    and coalesce(partner_id,intended_partner_id) = p_partner for update;
  if not found or o.status not in ('REQUESTED','IN_PROCESS','AT_PARTNER','READY') then
    return jsonb_build_object('ok',false,'reason','unavailable');
  end if;
  select * into i from partner_order_intakes where order_id = p_order and partner_id = p_partner;
  if p_action = 'accept' then
    if i.order_id is not null then return jsonb_build_object('ok',true,'already',true); end if;
    if o.status not in ('AT_PARTNER','READY') and not exists (
      select 1 from shipday_dispatch_plans where order_id = p_order and leg = 'TO_PARTNER'
        and state = 'ASSIGNED' and shipday_order_id is not null
    ) and not exists (
      select 1 from courier_deliveries where order_id = p_order and leg = 'TO_PARTNER'
        and delivery_id is not null and lower(coalesce(status,'')) not in ('canceled','cancelled','failed')
    ) then return jsonb_build_object('ok',false,'reason','unassigned'); end if;
    insert into partner_order_intakes(order_id,partner_id,received_by,received_by_admin) values(p_order,p_partner,case when not p_is_admin then p_actor end,case when p_is_admin then p_actor end);
    update orders set partner_id = p_partner, status = case when status = 'READY' then status else 'AT_PARTNER' end,
      at_partner_at = coalesce(at_partner_at,now()) where id = p_order;
    insert into order_events(order_id,kind,summary,actor) values
      (p_order,'PARTNER','Laundromat accepted delivery; awaiting intake',who);
  elsif p_action = 'intake' then
    if i.order_id is null then return jsonb_build_object('ok',false,'reason','receive_first'); end if;
    if ticket is null or ticket !~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$' or p_weight is null
      or p_weight::text in ('NaN','Infinity','-Infinity') or p_weight <= 0 or p_weight > 50 or p_weight <> round(p_weight,2) then
      return jsonb_build_object('ok',false,'reason','invalid_intake');
    end if;
    if i.completed_at is not null then
      return jsonb_build_object('ok',i.tracking_number = ticket and i.weight_lb = p_weight,
        'already',true,'reason','already_saved');
    end if;
    if o.status not in ('AT_PARTNER','READY') then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
    if exists (select 1 from partner_order_intakes other join orders oo on oo.id = other.order_id
      where other.partner_id = p_partner and other.order_id <> p_order
      and lower(other.tracking_number) = lower(ticket) and oo.status not in ('DELIVERED','CANCELED')) then
      return jsonb_build_object('ok',false,'reason','ticket_in_use');
    end if;
    update partner_order_intakes set tracking_number = ticket, weight_lb = p_weight,
      completed_at = now(), completed_by = case when not p_is_admin then p_actor end, completed_by_admin = case when p_is_admin then p_actor end where order_id = p_order;
    update orders set partner_weight_lb = p_weight, partner_weight_at = now() where id = p_order;
    insert into order_events(order_id,kind,summary,actor) values
      (p_order,'PARTNER_WEIGHT','Intake saved: ticket ' || ticket || ', full-order weight ' || p_weight || ' lb',who);
  elsif p_action = 'ready' then
    if i.completed_at is null then return jsonb_build_object('ok',false,'reason','intake_first'); end if;
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

create or replace function public.record_partner_intake(p_order uuid,p_partner uuid,p_staff uuid,p_action text,p_tracking text default null,p_weight numeric default null)
returns jsonb language sql security invoker set search_path=public as $$
  select record_partner_intake_as(p_order,p_partner,p_staff,false,p_action,p_tracking,p_weight);
$$;
create function public.record_partner_intake_admin(p_order uuid,p_partner uuid,p_admin uuid,p_action text,p_tracking text default null,p_weight numeric default null)
returns jsonb language sql security invoker set search_path=public as $$
  select record_partner_intake_as(p_order,p_partner,p_admin,true,p_action,p_tracking,p_weight);
$$;
revoke all on function public.record_partner_intake_as(uuid,uuid,uuid,boolean,text,text,numeric) from public,anon,authenticated;
revoke all on function public.record_partner_intake(uuid,uuid,uuid,text,text,numeric) from public,anon,authenticated;
revoke all on function public.record_partner_intake_admin(uuid,uuid,uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.record_partner_intake_as(uuid,uuid,uuid,boolean,text,text,numeric) to service_role;
grant execute on function public.record_partner_intake(uuid,uuid,uuid,text,text,numeric) to service_role;
grant execute on function public.record_partner_intake_admin(uuid,uuid,uuid,text,text,numeric) to service_role;
