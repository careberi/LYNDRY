-- Run only against the development database, in a transaction that is rolled back.
-- Uses an existing untouched boundary hold as a fixture. No remote service calls.
do $test$
declare o orders; p shipday_dispatch_plans; admin_id uuid; expected jsonb; snapshot jsonb;
  variant text; accepted boolean; failure text;
begin
 select * into strict p from shipday_dispatch_plans where state='REVIEW'
 and problem='This pickup crosses the Shipday UTC scheduling boundary. Dispatch review is required.'
 and booking_dispatch and not simulation and leg='TO_PARTNER'
 and shipday_order_id is null and assignment_requested_at is null and trip_snapshot is null and external_reference is null
 and order_id in(select id from orders where dev_quote_id is not null and status='REQUESTED') limit 1;
 select * into strict o from orders where id=p.order_id;
 select id into strict admin_id from ops_users where role='ADMIN' and status='ACTIVE' limit 1;
 expected:=jsonb_build_object('pickup_date',o.pickup_date,'pickup_time',o.pickup_time,'preferences',o.preferences,'pricing_snapshot',o.pricing_snapshot);
 snapshot:=jsonb_set(o.pricing_snapshot,'{expiresAt}',to_jsonb(now()+interval '1 hour'));
 foreach variant in array array['untouched','other review','null reason','remote id','assignment attempt','trip snapshot','external reference','processing','requested','assigned','simulation','not booking'] loop
  accepted:=false; failure:=null;
  begin
   update shipday_dispatch_plans set
    problem=case when variant='other review' then 'Unknown remote result' when variant='null reason' then null else p.problem end,
    shipday_order_id=case when variant='remote id' then '123456789' else null end,
    assignment_requested_at=case when variant='assignment attempt' then now() else null end,
    trip_snapshot=case when variant='trip snapshot' then '{}'::jsonb else null end,
    external_reference=case when variant='external reference' then 'LYNDRY-DEV-TEST-PICKUP' else null end,
    state=case when variant='processing' then 'PROCESSING' when variant='requested' then 'REQUESTED' when variant='assigned' then 'ASSIGNED' else 'REVIEW' end,
    simulation=(variant='simulation'), booking_dispatch=(variant<>'not booking')
   where id=p.id;
   begin
    perform edit_dev_pickup_details(o.id,admin_id,expected,((now() at time zone 'America/New_York')::date+1),'12:00'::time,o.preferences,snapshot);
    accepted:=true;
   exception when others then failure:=sqlerrm;
   end;
   if accepted then
    if not exists(select 1 from shipday_dispatch_plans where id=p.id and state='PLANNED' and shipday_order_id is null and assignment_requested_at is null and problem is null) then
     raise exception 'Regression: successful edit did not reset only the unrequested plan';
    end if;
   end if;
   -- Roll back every fixture mutation, including successful edits and audit rows.
   raise exception using errcode='P0099', message='rollback fixture';
  exception when sqlstate 'P0099' then null;
  end;
  if variant='untouched' and not accepted then raise exception 'Regression: untouched boundary hold blocked: %',failure; end if;
  if variant<>'untouched' and accepted then raise exception 'Regression: unsafe dispatch accepted: %',variant; end if;
  if variant<>'untouched' and failure not like '%courier job already exists%' and failure not like '%dispatch needs review%' then raise exception 'Unexpected guard for %: %',variant,failure; end if;
  raise notice 'PASS: %',variant;
 end loop;
end $test$;
