-- ---------------------------------------------------------------------------
-- 0088 — a person can set the order of the laundromat stops
-- ---------------------------------------------------------------------------
--
-- Neil, 11 September, out on the round: "in the route, drop off order #2059
-- before #1975". The route drove the laundromats in the shortest order - Fancy K
-- then Best Wash, 2.6 miles less - and nothing let a person say otherwise.
--
-- A rank, not a rule. Lower goes first. It only means anything while the order
-- is on its way to a laundromat; once the bags are handed over the stop is gone
-- and the rank is inert. Null is the ordinary case: the route decides.
--
-- Same idea as the pin in 0087: a decision a person made, written on the order,
-- which the route follows. See orderDropStops() in src/core/dispatch.js.
-- ---------------------------------------------------------------------------

alter table orders
  add column if not exists dropoff_rank smallint;

comment on column orders.dropoff_rank is
  'Set by a person to put this order''s laundromat stop in a fixed place on the '
  'route: lower goes first, before any unranked stop. Null means the route '
  'orders it by distance. See orderDropStops() in src/core/dispatch.js.';
