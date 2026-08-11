-- 0009_ops_roles.sql
--
-- What each person in ops_users is allowed to do.
--
-- A role, not a pile of per-person checkboxes. There are three kinds of people
-- here and they want completely different screens; picking one from a list is
-- something Neil can do without thinking about it, and the mapping from role
-- to permission lives in src/core/roles.js where it can be read in one go.

alter table ops_users
  -- DRIVER is the default on purpose: it is the least that any of these people
  -- need, so a row added carelessly grants the least. Promoting is deliberate.
  add column if not exists role text not null default 'DRIVER';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ops_users_role_check') then
    alter table ops_users add constraint ops_users_role_check
      check (role in ('ADMIN', 'DRIVER', 'SALES'));
  end if;
end $$;

-- Everyone who already had an account got there before roles existed, which
-- means they were being trusted with everything. Say so explicitly rather than
-- letting the DRIVER default silently lock the owner out of his own dashboard.
update ops_users set role = 'ADMIN' where role = 'DRIVER';
