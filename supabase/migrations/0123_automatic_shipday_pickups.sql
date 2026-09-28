-- Activation is explicit after validation. Old simulation plans are not enrolled.
alter table public.shipday_dispatch_settings add column automatic_pickups_from timestamptz;
alter table public.shipday_dispatch_plans
  add column booking_dispatch boolean not null default false,
  add column trip_snapshot jsonb,
  add column next_attempt_at timestamptz,
  add column assignment_requested_at timestamptz;
alter table public.shipday_dispatch_plans drop constraint shipday_dispatch_plans_state_check;
alter table public.shipday_dispatch_plans add constraint shipday_dispatch_plans_state_check
  check(state in ('PLANNED','PROCESSING','BLOCKED','REQUESTED','ASSIGNED','REVIEW','COMPLETED','CANCELED'));
create index shipday_booking_dispatch_pending on public.shipday_dispatch_plans(updated_at)
  where booking_dispatch and state not in ('COMPLETED','CANCELED');
-- Creation already sends the complete snapshot. Later customer/order changes
-- still queue review, but linking a new ID must not race assignment with edits.
drop trigger shipday_plan_linked on public.shipday_dispatch_plans;
create trigger shipday_plan_linked after insert or update of shipday_order_id on public.shipday_dispatch_plans
for each row when (not new.booking_dispatch) execute function public.shipday_delivery_edit_trigger();
