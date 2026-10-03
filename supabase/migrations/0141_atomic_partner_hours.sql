-- Atomic full-week replacement. Invalid rows and failed inserts retain the old week.
create or replace function public.replace_partner_hours(p_partner uuid, p_hours jsonb)
returns setof public.partner_hours
language plpgsql security definer set search_path = public as $$
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then raise exception 'Hours must be an array'; end if;
  perform 1 from public.partners where id=p_partner for update;
  if not found then raise exception 'Partner not found'; end if;
  if exists(select 1 from jsonb_to_recordset(p_hours) as x(weekday integer,opens_at time,closes_at time)
    where weekday is null or weekday not between 0 and 6 or opens_at is null or closes_at is null or closes_at<=opens_at)
    then raise exception 'Invalid hours interval'; end if;
  if exists(with intervals as (select ordinal, (value->>'weekday')::integer as day,
    (value->>'opens_at')::time as opens, (value->>'closes_at')::time as closes
    from jsonb_array_elements(p_hours) with ordinality as x(value,ordinal))
    select 1 from intervals a join intervals b on a.ordinal<b.ordinal and a.day=b.day and a.opens<b.closes and b.opens<a.closes)
    then raise exception 'Overlapping hours intervals'; end if;
  delete from public.partner_hours where partner_id=p_partner;
  return query insert into public.partner_hours(partner_id,weekday,opens_at,closes_at)
    select p_partner,x.weekday,x.opens_at,x.closes_at from jsonb_to_recordset(p_hours) as x(weekday integer,opens_at time,closes_at time)
    returning *;
end;$$;
revoke all on function public.replace_partner_hours(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_partner_hours(uuid,jsonb) to service_role;
