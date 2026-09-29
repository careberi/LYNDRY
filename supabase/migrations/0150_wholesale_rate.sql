-- ---------------------------------------------------------------------------
-- A CUSTOMER WITH AN AGREED RATE OF THEIR OWN.
--
-- Neil, 29 September: Bris Avrohom is a wholesale account, charged $1.00 a
-- pound on every order rather than $2.00 one-time or $1.80 on a plan.
--
-- ONE COLUMN, NOT A FLAG AND A NUMBER. A non-null rate IS the wholesale
-- account; there is no `is_wholesale` boolean beside it that could disagree
-- with the figure. Same reasoning as config.supabase.isProduction being read
-- off the URL rather than declared.
--
-- WHAT IT CARRIES BEYOND THE RATE. Neil's two calls, made when this was built:
-- a wholesale customer has NO order minimum (a 15 lb load bills $15.00, so
-- "always a dollar a pound" is true rather than nearly true), and NO
-- promotions (wholesale is the deal; CLEAN50 on top would make it $0.50). Both
-- are derived from this one column in src/core/wholesale.js, so neither needs
-- a column of its own and neither can be set without the rate being set.
--
-- IT IS NOT RETROACTIVE. orders.price_per_lb_cents and orders.minimum_cents are
-- snapshotted at booking and stay there, which is the rule this codebase
-- already keeps everywhere: setting this today changes what the next pickup is
-- booked at and leaves every order already taken exactly as it was sold.
--
-- THE NUMBER IS 0150 ON PURPOSE. `main` had reached 0100 and `dev` was already
-- past 0125 on a separate line, so the next free number on main would have
-- collided with a different file of the same name the day the two branches
-- meet. The gap is the signal.
-- ---------------------------------------------------------------------------

alter table customers
  add column if not exists wholesale_rate_cents integer;

-- A rate of zero would be free laundry dressed up as a price, and a negative
-- one is nonsense. Null is the ordinary state: not a wholesale account.
alter table customers
  drop constraint if exists customers_wholesale_rate_positive;

alter table customers
  add constraint customers_wholesale_rate_positive
  check (wholesale_rate_cents is null or wholesale_rate_cents > 0);

comment on column customers.wholesale_rate_cents is
  'Agreed price per pound in cents for a wholesale account. Null for everybody '
  'else. Non-null also means no order minimum and no promotions - see '
  'src/core/wholesale.js, which is the only place those three are decided.';
