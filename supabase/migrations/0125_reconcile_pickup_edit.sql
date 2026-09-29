-- Consume fresh server-side reconciliation while retaining the order edit guards.
create function edit_dev_pickup_details_reconciled(
 p_order uuid,p_admin uuid,p_expected jsonb,p_date date,p_time time,p_preferences jsonb,p_snapshot jsonb,
 p_plan uuid,p_version integer,p_remote text,p_outcome text,p_trip jsonb,p_state text,p_assigned text
) returns void language plpgsql security invoker set search_path=public as $$
declare p shipday_dispatch_plans;
begin
 perform 1 from orders where id=p_order for update;
 select * into strict p from shipday_dispatch_plans where id=p_plan and order_id=p_order and leg='TO_PARTNER' for update;
 if p.state<>'PROCESSING' or p.version<>p_version or p.shipday_order_id is distinct from p_remote
 or p.updated_at<now()-interval '2 minutes' then raise exception 'Assignment changed. Refresh before editing'; end if;
 if p_outcome not in ('MISSING','UPDATED') then raise exception 'Invalid Shipday reconciliation'; end if;
 if p_outcome='UPDATED' and (p_trip is null or p_state not in ('ASSIGNED','BLOCKED')
   or p_trip->>'externalId' is distinct from p.external_reference
   or (p_trip->>'pickupReadyAt')::timestamptz is distinct from (p_date+p_time) at time zone 'America/New_York')
 then raise exception 'Updated Shipday schedule does not match'; end if;
 -- No worker can observe this temporary release: both changes commit together.
 update shipday_dispatch_plans set shipday_order_id=null,assignment_requested_at=null,state='PLANNED' where id=p_plan;
 perform edit_dev_pickup_details(p_order,p_admin,p_expected,p_date,p_time,p_preferences,p_snapshot);
 update shipday_dispatch_plans set
  shipday_order_id=case when p_outcome='UPDATED' then p.shipday_order_id else null end,
  external_reference=case when p_outcome='UPDATED' then p.external_reference else null end,
  trip_snapshot=case when p_outcome='UPDATED' then p_trip else null end,
  assignment_requested_at=case when p_outcome='UPDATED' and p_state='ASSIGNED' then p.assignment_requested_at else null end,
  assigned_name=case when p_outcome='UPDATED' then p_assigned else null end,
  tracking_url=case when p_outcome='UPDATED' then p.tracking_url else null end,
  state=case when p_outcome='MISSING' then 'CANCELED' else p_state end,
  problem=case when p_outcome='MISSING' then 'Previous Shipday job was removed. Details saved; choose Assign to request a new driver.' else null end,
  next_attempt_at=null,updated_at=now(),
  history=coalesce(p.history,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('event','PICKUP_EDIT_'||p_outcome,'actor',p_admin,'at',now(),'previous_shipday_order_id',p.shipday_order_id))
 where id=p_plan;
 insert into order_events(order_id,kind,summary,actor) values(p_order,'NOTE',
  case when p_outcome='MISSING' then 'Removed stale Shipday link after successful lookup; no replacement requested' else 'Scheduled Shipday pickup updated in place and verified' end,p_admin::text);
end $$;
revoke all on function edit_dev_pickup_details_reconciled(uuid,uuid,jsonb,date,time,jsonb,jsonb,uuid,integer,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function edit_dev_pickup_details_reconciled(uuid,uuid,jsonb,date,time,jsonb,jsonb,uuid,integer,text,text,jsonb,text,text) to service_role;
