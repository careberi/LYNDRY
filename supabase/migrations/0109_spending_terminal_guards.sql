-- Reject approval on orders completed after the proposal was displayed.
create or replace function propose_order_spending(p_order uuid, p_estimate integer, p_limit integer, p_pickup integer, p_return integer, p_reason text, p_actor text)
returns order_spending_controls language plpgsql security invoker set search_path = public as $$
declare o orders; c order_spending_controls;
begin
  select * into strict o from orders where id = p_order for update;
  if o.status in ('DELIVERED','CANCELLED','CANCELED') or o.payment_status = 'PAID' then
    raise exception 'A completed or paid order cannot receive a new spending proposal';
  end if;
  if p_estimate is null or p_limit is null or p_estimate <= 0 or p_limit < p_estimate
    or length(trim(coalesce(p_reason,''))) = 0 then raise exception 'Invalid spending proposal'; end if;
  insert into order_spending_controls(order_id, customer_id, estimated_total_cents, proposed_limit_cents, pickup_budget_cents, return_budget_cents, reason)
    values(o.id, o.customer_id, p_estimate, p_limit, p_pickup, p_return, left(p_reason,1000))
    on conflict(order_id) do update set revision = gen_random_uuid(),
      estimated_total_cents = excluded.estimated_total_cents,
      proposed_limit_cents = excluded.proposed_limit_cents, reason = excluded.reason,
      pickup_budget_cents = excluded.pickup_budget_cents, return_budget_cents = excluded.return_budget_cents,
      pending = true, updated_at = now()
    returning * into c;
  insert into order_spending_events(order_id, revision, kind, actor, estimated_total_cents, limit_cents, reason)
    values(c.order_id,c.revision,'PROPOSED',p_actor,c.estimated_total_cents,c.proposed_limit_cents,c.reason);
  return c;
end $$;

-- The authenticated customer's ID comes from the server session, never the form.
create or replace function approve_order_spending(p_order uuid, p_customer uuid, p_revision uuid)
returns order_spending_controls language plpgsql security invoker set search_path = public as $$
declare c order_spending_controls; o orders;
begin
  select * into strict o from orders where id = p_order for update;
  if o.status in ('DELIVERED','CANCELED','CANCELLED') or o.payment_status = 'PAID' then
    raise exception 'This order is no longer awaiting spending approval';
  end if;
  select * into strict c from order_spending_controls where order_id = p_order for update;
  if c.customer_id <> p_customer or c.revision <> p_revision then
    raise exception 'This proposal has changed or does not belong to this customer';
  end if;
  if not c.pending then return c; end if;
  update order_spending_controls set approved_limit_cents = proposed_limit_cents,
    approved_at = now(), pending = false, updated_at = now() where order_id = p_order returning * into c;
  insert into order_spending_events(order_id, revision, kind, actor, estimated_total_cents, limit_cents, reason)
    values(c.order_id,c.revision,'APPROVED',p_customer::text,c.estimated_total_cents,c.approved_limit_cents,'Customer approved the displayed spending limit');
  return c;
end $$;

