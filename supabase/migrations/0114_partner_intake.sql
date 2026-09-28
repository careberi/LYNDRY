-- Attendant receipt is independent of a courier's delivered status.
create table public.partner_order_intakes (
  order_id uuid primary key references public.orders(id) on delete cascade,
  partner_id uuid not null references public.partners(id),
  received_at timestamptz not null default now(),
  received_by uuid not null references public.partner_users(id),
  tracking_number text,
  weight_lb numeric,
  completed_at timestamptz,
  completed_by uuid references public.partner_users(id),
  ready_at timestamptz,
  ready_by uuid references public.partner_users(id),
  needs_review boolean not null default false,
  check ((completed_at is null and tracking_number is null and weight_lb is null and completed_by is null)
    or (completed_at is not null and tracking_number is not null and length(btrim(tracking_number)) between 1 and 64
      and weight_lb > 0 and weight_lb <= 50 and completed_by is not null))
);
alter table public.partner_order_intakes enable row level security;
create index partner_order_intakes_partner on public.partner_order_intakes(partner_id);
alter table public.shipday_dispatch_plans add column external_reference text;

-- All three mutations lock the order, verify the current shop and staff, and
-- append their audit event in the same transaction. Replays change nothing.
create function public.record_partner_intake(
  p_order uuid, p_partner uuid, p_staff uuid, p_action text,
  p_tracking text default null, p_weight numeric default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  o orders%rowtype;
  i partner_order_intakes%rowtype;
  who text;
  ticket text := btrim(p_tracking);
begin
  select u.name || ' at ' || p.name into who from partner_users u
    join partners p on p.id = u.partner_id
    where u.id = p_staff and u.partner_id = p_partner
      and u.status = 'ACTIVE' and p.status = 'ACTIVE';
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
    insert into partner_order_intakes(order_id,partner_id,received_by) values(p_order,p_partner,p_staff);
    update orders set partner_id = p_partner, status = case when status = 'READY' then status else 'AT_PARTNER' end,
      at_partner_at = coalesce(at_partner_at,now()) where id = p_order;
    insert into order_events(order_id,kind,summary,actor) values
      (p_order,'PARTNER','Laundromat accepted delivery; awaiting intake',who);
  elsif p_action = 'intake' then
    if i.order_id is null then return jsonb_build_object('ok',false,'reason','receive_first'); end if;
    if ticket is null or ticket !~ '^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$' or p_weight is null
      or p_weight::text in ('NaN','Infinity','-Infinity') or p_weight <= 0 or p_weight > 50 then
      return jsonb_build_object('ok',false,'reason','invalid_intake');
    end if;
    if i.completed_at is not null then
      return jsonb_build_object('ok',i.tracking_number = ticket and i.weight_lb = p_weight,
        'already',true,'reason','already_saved');
    end if;
    if o.status <> 'AT_PARTNER' then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
    if exists (select 1 from partner_order_intakes other join orders oo on oo.id = other.order_id
      where other.partner_id = p_partner and other.order_id <> p_order
      and lower(other.tracking_number) = lower(ticket) and oo.status not in ('DELIVERED','CANCELED')) then
      return jsonb_build_object('ok',false,'reason','ticket_in_use');
    end if;
    update partner_order_intakes set tracking_number = ticket, weight_lb = p_weight,
      completed_at = now(), completed_by = p_staff where order_id = p_order;
    update orders set partner_weight_lb = p_weight, partner_weight_at = now() where id = p_order;
    insert into order_events(order_id,kind,summary,actor) values
      (p_order,'PARTNER_WEIGHT','Intake saved: ticket ' || ticket || ', full-order weight ' || p_weight || ' lb',who);
  elsif p_action = 'ready' then
    if i.completed_at is null then return jsonb_build_object('ok',false,'reason','intake_first'); end if;
    if i.ready_at is not null then return jsonb_build_object('ok',true,'already',true); end if;
    update partner_order_intakes set ready_at = now(), ready_by = p_staff where order_id = p_order;
    update orders set status = 'READY', ready_at = coalesce(ready_at,now()) where id = p_order;
    insert into order_events(order_id,kind,summary,actor) values
      (p_order,'PARTNER','Laundromat marked laundry ready for return',who);
  else
    return jsonb_build_object('ok',false,'reason','unavailable');
  end if;
  return jsonb_build_object('ok',true,'already',false);
end;
$$;
revoke all on function public.record_partner_intake(uuid,uuid,uuid,text,text,numeric) from public, anon, authenticated;
grant execute on function public.record_partner_intake(uuid,uuid,uuid,text,text,numeric) to service_role;
