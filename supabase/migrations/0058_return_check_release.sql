-- 0058  A LOAD THAT DOES NOT RECONCILE CANNOT GO OUT FOR DELIVERY.
--
-- Six bags and 113.5 lb came back off a laundromat against 60.0 lb collected
-- from the customer. The order page said so plainly - "laundry does not get
-- heavier in a dryer, check whether somebody else's bag is in this pile" - and
-- the driver's screen sent him straight on to the delivery anyway. The check
-- was advisory; nothing was gated on it.
--
-- Neil's rule: the run stops, the driver is told to contact an admin, and only
-- an admin can release it.
--
-- These three columns are that release. An order with return_override_at set
-- has been looked at by a person who decided it may go out regardless; the
-- reason and the name are kept because the whole value of the check is that
-- somebody other than the driver in a hurry agreed to skip it.
--
-- NULL is the ordinary state and means "not released" - which only matters for
-- an order whose weights actually disagree. Everything that reconciles goes out
-- without any of this being touched.

alter table orders add column if not exists return_override_at timestamptz;
alter table orders add column if not exists return_override_by uuid references ops_users(id);
alter table orders add column if not exists return_override_reason text;

comment on column orders.return_override_at is
  'When an admin released a return load whose weight did not reconcile against '
  'what was collected. Null means it was never blocked, or is still blocked.';

comment on column orders.return_override_by is
  'Which admin released it. The check exists so that somebody other than the '
  'driver agrees to skip it, so the name is the point.';

comment on column orders.return_override_reason is
  'Why they released it, in their own words. Also written to order_events.';

-- Finding the blocked ones is a question somebody asks; released ones are rare.
create index if not exists orders_return_override_idx
  on orders (return_override_at) where return_override_at is not null;
