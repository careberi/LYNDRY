-- ---------------------------------------------------------------------------
-- 0030 — an admin can put themselves on the round.
--
-- BEING A DRIVER AND DOING A DRIVER'S JOB ARE TWO DIFFERENT THINGS, and the
-- system used to conflate them: the driver pool was "anyone who can move an
-- order along", which every admin can, because correcting a fat-fingered weight
-- is admin work. So orders were being assigned to whoever was sitting at a desk.
--
-- The fix is not to lock admins out. In a business this size the owner drives
-- some days and does not drive others, and that is a thing he decides on a
-- Tuesday morning rather than a property of his job title.
--
-- So: a DRIVER always drives - that is the role, and there is nothing to
-- toggle. An ADMIN drives only while this is switched on. SALES never does.
-- The column is only ever consulted for an admin, which is why it is not kept
-- in step with the role: a driver's row can say anything and it changes
-- nothing.
-- ---------------------------------------------------------------------------

alter table ops_users add column if not exists drives boolean not null default false;

comment on column ops_users.drives is
  'Whether this ADMIN is currently on the round. Only read for admins - a '
  'DRIVER always drives and a SALES never does, both by role. Toggled from the '
  'Team page.';
