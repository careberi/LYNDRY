-- Run with 0145 applied inside a transaction, then roll back all fixture changes.
do $test$
declare o orders; p shipday_dispatch_plans; shop partners; customer customers;
  admin_id uuid; variant text; result jsonb; shop_json jsonb; customer_json jsonb;
begin
 select r.* into strict o from orders r join partner_order_intakes i on i.order_id=r.id
   where r.status='READY' and i.ready_at is not null and i.completed_at is not null and i.received_verified_at is not null limit 1;
 select * into strict p from shipday_dispatch_plans where order_id=o.id and leg='TO_CUSTOMER';
 select * into strict shop from partners where id=o.partner_id;
 select * into strict customer from customers where id=o.customer_id;
 select id into strict admin_id from ops_users where status='ACTIVE' and role='ADMIN' limit 1;
 shop_json:=jsonb_build_object('name',shop.name,'address_line1',shop.address_line1,'address_line2',shop.address_line2,'city',shop.city,'state',shop.state,'postal_code',shop.postal_code);
 customer_json:=jsonb_build_object('name',customer.name,'address_line1','Return test address','address_line2',null,'city','Test town','state','NJ','postal_code','07000');
 foreach variant in array array['third party','in house','stale','version','simulation','unpaid','wrong driver','wrong endpoint','no request','uncollected'] loop
  begin
   update orders set payment_status='PAID',preferences=jsonb_set(coalesce(preferences,'{}'),'{pickup_address}',customer_json-'name') where id=o.id;
   update partner_order_intakes set collected_at=null,return_check_status='PASSED' where order_id=o.id;
   update shipday_dispatch_plans set mode=case when variant in ('in house','wrong driver') then 'IN_HOUSE' else 'THIRD_PARTY' end,
     state='ASSIGNED',simulation=(variant='simulation'),shipday_order_id='77777777',driver_id=case when variant in ('in house','wrong driver') then '9' else null end,
     assignment_requested_at=case when variant='no request' then null else now() end where id=p.id;
   if variant='unpaid' then update orders set payment_status='UNPAID' where id=o.id; end if;
   result:=confirm_partner_return_collection(o.id,o.partner_id,admin_id,true,p.id,
     p.version+case when variant='version' then 1 else 0 end,'77777777',
     case when variant='in house' then '9' when variant='wrong driver' then '10' else null end,
     case when variant='uncollected' then 'STARTED' else 'PICKED_UP' end,
     now()-case when variant='stale' then interval '1 minute' else interval '0' end,shop_json,
     case when variant='wrong endpoint' then jsonb_set(customer_json,'{city}','"Wrong"') else customer_json end);
   if variant in ('third party','in house') then
     if result->>'ok'<>'true' or not exists(select 1 from orders where id=o.id and status='OUT_FOR_DELIVERY') then raise exception 'Expected verified handoff: % %',variant,result; end if;
   elsif result->>'ok'<>'false' then raise exception 'Unsafe handoff accepted: %',variant;
   end if;
   raise exception using errcode='P0099',message='rollback fixture';
  exception when sqlstate 'P0099' then null;
  end;
  raise notice 'PASS: %',variant;
 end loop;
end $test$;
