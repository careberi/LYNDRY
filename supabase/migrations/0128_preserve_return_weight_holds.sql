-- Disabling the rollout cannot clear an already-recorded weight discrepancy.
create or replace function public.partner_return_weight_allowed(p_order uuid)
returns boolean language sql stable security invoker set search_path=public as $$
  select not exists(select 1 from partner_order_intakes where order_id=p_order and return_check_status='HELD')
    and (not exists(select 1 from laundromat_workflow_settings where weight_tolerance_lb is not null)
      or exists(select 1 from partner_order_intakes where order_id=p_order and return_check_status in ('PASSED','RELEASED')));
$$;
-- An intake resumed after an earlier receipt still starts from actual receipt.
drop trigger partner_intake_deadline on public.partner_order_intakes;
create trigger partner_intake_deadline before insert or update of received_at,partner_id on public.partner_order_intakes
  for each row execute function public.partner_intake_deadline();
