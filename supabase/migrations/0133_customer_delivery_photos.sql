-- Only new delivered notifications opt into photo sending. Historical messages stay untouched.
alter table public.messages add column media_path text;
alter table public.delivery_sms_outbox
 add column photo_state text check(photo_state in ('WAITING','PREPARING','SENDING','SENT','SIMULATED','SKIPPED','REVIEW')),
 add column photo_version integer not null default 0,
 add column photo_updated_at timestamptz,
 add column photo_problem text,
 add column photo_path text;
create or replace function public.queue_delivery_sms(p_order uuid,p_leg text,p_version integer,p_rank integer,p_key text,p_body text,p_remote text,p_eta timestamptz)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  update delivery_sms_state set rank=p_rank,version=version+1,last_eta_at=p_eta,last_message_at=now()
    where order_id=p_order and leg=p_leg and version=p_version and rank<=p_rank;
  if not found then return false; end if;
  insert into delivery_sms_outbox(order_id,leg,event_key,rank,body,remote_id,photo_state)
    values(p_order,p_leg,p_key,p_rank,p_body,p_remote,case when p_leg='TO_CUSTOMER' and p_key='milestone-3' then 'WAITING' end);
  return true;
end;
$$;
revoke all on function public.queue_delivery_sms(uuid,text,integer,integer,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.queue_delivery_sms(uuid,text,integer,integer,text,text,text,timestamptz) to service_role;

create function public.claim_delivery_photo(p_id uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare claimed delivery_sms_outbox%rowtype;
begin
 update delivery_sms_outbox set photo_state='PREPARING',photo_version=photo_version+1,photo_updated_at=now()
 where id=p_id and photo_state='WAITING' and state in ('SENT','SIMULATED')
 and leg='TO_CUSTOMER' and event_key='milestone-3' and created_at>=now()-interval '24 hours'
 returning * into claimed;
 if not found then return null; end if;
 return to_jsonb(claimed);
end;
$$;
revoke all on function public.claim_delivery_photo(uuid) from public,anon,authenticated;
grant execute on function public.claim_delivery_photo(uuid) to service_role;
create index delivery_photos_pending on public.delivery_sms_outbox(created_at) where photo_state in ('WAITING','PREPARING','SENDING');
