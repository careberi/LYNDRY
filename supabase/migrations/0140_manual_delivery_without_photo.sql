-- Manual admin recovery is silent and requires no photo.
alter table public.orders add column delivery_notifications_suppressed boolean not null default false;
-- Development recovery records completion without billing or customer notifications.
create or replace function public.complete_dev_order_recovery(
 p_order uuid,p_actor uuid,p_source text,p_reason text,p_photo text,p_checked timestamptz,
 p_plan uuid,p_version integer,p_remote text,p_expected jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare o orders%rowtype; who text;
begin
 select name into who from ops_users where id=p_actor and status='ACTIVE' and role='ADMIN';
 if who is null then raise exception 'Administrator access required'; end if;
 select * into o from orders where id=p_order for update;
 if not found or o.dev_quote_id is null then raise exception 'Development order required'; end if;
 if o.status='DELIVERED' then return jsonb_build_object('ok',true,'already',true); end if;
 if o.status<>'OUT_FOR_DELIVERY' or o.payment_status not in ('PAID','WAIVED') then raise exception 'Order state or payment changed. Refresh before completing.'; end if;
 if (p_expected-'customer'-'shop') is distinct from jsonb_build_object('partner_id',o.partner_id,'preferences',o.preferences,'customer_id',o.customer_id) then raise exception 'Order details changed. Refresh before completing.'; end if;
 if p_source not in ('SHIPDAY','MANUAL') or p_source is null or length(trim(p_reason))<10 or length(p_reason)>1000 then raise exception 'A valid correction reason is required'; end if;
 if p_source='SHIPDAY' and (p_photo is null or p_photo not like o.id::text || '/recovery-%.jpg') then raise exception 'Delivery proof is required'; end if;
 if p_checked is null or p_checked<now()-interval '60 seconds' or p_checked>now()+interval '5 seconds' then raise exception 'Evidence expired. Try again.'; end if;
 if p_source='SHIPDAY' then
  perform 1 from customers c,partners p where c.id=o.customer_id and p.id=o.partner_id and to_jsonb(c)=p_expected->'customer' and to_jsonb(p)=p_expected->'shop' for share of c,p;
  if not found then raise exception 'Delivery endpoints changed. Sync again.'; end if;
  perform 1 from shipday_dispatch_plans where id=p_plan and order_id=p_order and leg='TO_CUSTOMER' and not simulation and version=p_version and shipday_order_id=p_remote for update;
  if not found then raise exception 'Return assignment changed. Sync again.'; end if;
 end if;
 update orders set status='DELIVERED',delivered_at=coalesce(delivered_at,now()),delivery_photo_path=coalesce(p_photo,delivery_photo_path),delivery_notifications_suppressed=delivery_notifications_suppressed or p_source='MANUAL',arrived_at=null,navigating_at=null where id=p_order;
 insert into order_events(order_id,kind,actor,summary,was,became,reason) values(p_order,'STATUS',who,
  case when p_source='SHIPDAY' then 'Delivery reconciled from verified Shipday proof' else 'Delivery confirmed by administrator without customer notification' end,
  o.status,'DELIVERED',p_reason);
 return jsonb_build_object('ok',true,'already',false);
end;$$;
revoke all on function public.complete_dev_order_recovery(uuid,uuid,text,text,text,timestamptz,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_dev_order_recovery(uuid,uuid,text,text,text,timestamptz,uuid,integer,text,jsonb) to service_role;
