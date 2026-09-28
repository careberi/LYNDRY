-- New development checkout keeps approved pricing separate from legacy orders.
create table dev_pricing_policies (
  id uuid primary key default gen_random_uuid(),
  effective_at timestamptz not null default now(),
  policy jsonb not null,
  created_at timestamptz not null default now()
);
alter table dev_pricing_policies enable row level security;
insert into dev_pricing_policies(policy) values ('{"marginBps":{"ONE_TIME":2000,"SUBSCRIPTION":1000,"WHOLESALE":500},"processingBps":290,"processingFixedCents":30,"operationalFeeBps":2500,"referenceWeightLb":33}');

create table dev_order_quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  pickup_date date not null,
  pickup_time text not null,
  address jsonb not null,
  snapshot jsonb not null,
  expires_at timestamptz not null,
  approved_at timestamptz,
  approved_limit_cents integer check(approved_limit_cents > 0),
  order_id uuid references orders(id),
  created_at timestamptz not null default now()
);
alter table dev_order_quotes enable row level security;
alter table orders add column dev_quote_id uuid unique references dev_order_quotes(id),
  add column pricing_snapshot jsonb,
  add column pending_pricing_snapshot jsonb;
alter table booking_intents add column dev_quote_id uuid references dev_order_quotes(id);

create function apply_dev_order_quote() returns trigger language plpgsql security invoker set search_path=public as $$
declare q dev_order_quotes; c customers;
begin
  if new.dev_quote_id is null then return new; end if;
  select * into strict q from dev_order_quotes where id=new.dev_quote_id for update;
  select * into strict c from customers where id=new.customer_id;
  if q.customer_id<>new.customer_id or q.approved_at is null or q.expires_at<now() or q.order_id is not null
    or q.pickup_date<>new.pickup_date or q.pickup_time::time<>new.pickup_time then
    raise exception 'The approved quote is stale or does not match this booking';
  end if;
  if q.address <> jsonb_build_object('address_line1',c.address_line1,'address_line2',c.address_line2,'city',c.city,'postal_code',c.postal_code) then
    raise exception 'The pickup address changed. Request a new quote';
  end if;
  if c.default_payment_method_id is null then raise exception 'Save a test payment card before booking'; end if;
  new.price_per_lb_cents := (q.snapshot->>'rateCentsPerLb')::integer;
  new.minimum_cents := (q.snapshot->>'minimumTotalCents')::integer;
  new.pricing_snapshot := q.snapshot;
  new.intended_partner_id := (q.snapshot->>'partnerId')::uuid;
  new.intended_partner_at := now();
  new.driver_id := null;
  new.pickup_window_start := null;
  new.pickup_window_end := null;
  return new;
end $$;
create trigger apply_dev_order_quote before insert on orders for each row execute function apply_dev_order_quote();

create function record_dev_order_approval() returns trigger language plpgsql security invoker set search_path=public as $$
declare q dev_order_quotes; r uuid:=gen_random_uuid();
begin
  if new.dev_quote_id is null then return new; end if;
  update dev_order_quotes set order_id=new.id where id=new.dev_quote_id returning * into q;
  insert into order_spending_controls(order_id,customer_id,revision,estimated_total_cents,pickup_budget_cents,return_budget_cents,proposed_limit_cents,approved_limit_cents,approved_at,pending,reason)
  values(new.id,new.customer_id,r,(q.snapshot->>'estimatedReferenceTotalCents')::integer,(q.snapshot->>'pickupCents')::integer,(q.snapshot->>'returnCents')::integer,q.approved_limit_cents,q.approved_limit_cents,q.approved_at,false,'Customer approved development quote at checkout');
  insert into order_spending_events(order_id,revision,kind,actor,estimated_total_cents,limit_cents,reason)
  values(new.id,r,'APPROVED',new.customer_id::text,(q.snapshot->>'estimatedReferenceTotalCents')::integer,q.approved_limit_cents,'Checkout approval; development courier estimates');
  return new;
end $$;
create trigger record_dev_order_approval after insert on orders for each row execute function record_dev_order_approval();

-- Apply a revised price only in the same transaction as customer approval.
create function apply_revised_dev_price() returns trigger language plpgsql security invoker set search_path=public as $$
declare p jsonb;
begin
  if old.pending and not new.pending then
    select pending_pricing_snapshot into p from orders where id=new.order_id for update;
    if p is not null then
      update orders set pricing_snapshot=p,pending_pricing_snapshot=null,
        price_per_lb_cents=(p->>'rateCentsPerLb')::integer,minimum_cents=(p->>'minimumTotalCents')::integer,
        price_cents=(p->>'finalTotalCents')::integer where id=new.order_id;
    end if;
  end if;
  return new;
end $$;
create trigger apply_revised_dev_price after update on order_spending_controls for each row execute function apply_revised_dev_price();
