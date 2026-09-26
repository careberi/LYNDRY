-- 0102_partner_owner_and_slug.sql
--
-- A LAUNDROMAT GETS ITS OWN URL, AND AN OWNER WHO RUNS ITS OWN STAFF.
--
-- Neil, 25 September: "when I add a laundromat, they should get their own url
-- that they can log into and i should be able to assign the owner of the
-- laundromat to be the admin of that account. the owner should be able to add
-- and remove attendants."
--
-- Two columns, and each answers a different half.

-- ---------------------------------------------------------------------------
-- The URL
-- ---------------------------------------------------------------------------
--
-- `/shop/riverside-wash-co` is what a shop bookmarks on the tablet behind the
-- counter. It is NOT a credential and must never become one: it names which
-- laundromat you are signing in to, and the six-digit code is still what gets
-- anybody in. What it buys is that the attendant lands on a page with her own
-- shop's name on it rather than a generic box, which is the difference between
-- a bookmark somebody trusts and one they ring us about.
--
-- DERIVED FROM THE NAME, NOT RANDOM, because the whole point is that it is
-- memorable and typable. The cost is that guessing `riverside-wash-co`
-- confirms we work with Riverside Wash Co - but guessing it requires already
-- knowing the name, so it tells somebody what they had to know to ask. An
-- unknown slug redirects to the plain sign-in rather than 404ing, so the page
-- is not an oracle either way and a typo'd bookmark still works.
--
-- NULLABLE, because a partner can exist before anybody has signed in for them,
-- and PROPERTY_MANAGER partners have no portal at all.
alter table partners add column if not exists slug text;

-- UNIQUE WHERE IT EXISTS. A partial index rather than a plain unique
-- constraint, because several partners legitimately have no slug and Postgres
-- would otherwise be fine with that anyway - but naming it partial says out
-- loud that null is an ordinary state here rather than a gap to fill in.
create unique index if not exists partners_slug_key on partners (slug) where slug is not null;

comment on column partners.slug is
  'URL-safe name for the laundromat portal at /shop/<slug>. Not a credential: '
  'signing in still needs a texted code. Generated from the partner name.';

-- ---------------------------------------------------------------------------
-- The owner
-- ---------------------------------------------------------------------------
--
-- TWO ROLES AND DELIBERATELY NOT MORE. An OWNER can add and remove the people
-- at their own shop; an ATTENDANT can do the work. That is the whole ladder,
-- because a laundromat is four people and a counter, and every role beyond the
-- one somebody actually needs is a permission nobody audits.
--
-- THE DEFAULT IS ATTENDANT, which is the same polarity as `ops_users`
-- defaulting to DRIVER: the least privileged value, so a row created by a
-- script, a form or a future door that forgets to say is the safe one. Being
-- promoted is deliberate.
--
-- NEIL ASSIGNS THE OWNER, AND AN OWNER CANNOT MINT ANOTHER. That is the point
-- of the split: a shop manages its own staff and cannot grow its own admin
-- rights, so the worst an owner can do is add and remove people at the shop
-- they already run. Promotion is a decision about the relationship, and those
-- are LYNDRY's.
alter table partner_users add column if not exists role text not null default 'ATTENDANT';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'partner_users_role_check') then
    alter table partner_users add constraint partner_users_role_check
      check (role in ('OWNER', 'ATTENDANT'));
  end if;
end $$;

comment on column partner_users.role is
  'OWNER may add and remove the attendants at their own laundromat. ATTENDANT '
  'may do the work. Only LYNDRY promotes somebody to OWNER.';

-- NOTHING IS BACKFILLED TO OWNER, on purpose.
--
-- The two rows in this table were created the day before this migration, in
-- development, and there are none in production. A backfill would be harmless
-- today and would set exactly the wrong precedent: the next time a role column
-- is added to a table with real rows in it, "promote everybody who was already
-- there" is the shape of change that hands out admin rights silently. Whoever
-- should own a shop is named by a person, on the partner's own page.
