-- ---------------------------------------------------------------------------
-- 0073 — a promotion can run out.
--
-- Neil's ask, and it comes from a real offer: "the first 20 people to put in
-- orders get the orders for free". Every promotion until now was unlimited -
-- it ran until somebody ended it by hand - so an offer with a number in it
-- could not be set up at all, and the number in the advert would have been a
-- sentence nobody was counting.
--
-- IT COUNTS PEOPLE GIVEN IT, NOT ORDERS PLACED, and that is a deliberate
-- difference from the way the offer is worded. The alternative is to count
-- redemptions, which means the twenty-first holder is told it is free and then
-- charged at the door - the one outcome worth designing around. Capping the
-- grants means everybody who has been promised it gets it, and the promise is
-- simply not made again once the last one is gone.
--
-- Null is what every existing promotion is: no cap, exactly as before.
-- ---------------------------------------------------------------------------

alter table promotions
  add column if not exists max_grants integer
    check (max_grants is null or max_grants > 0);

comment on column promotions.max_grants is
  'How many people may ever hold this. Null means no limit. Counted in grants '
  'rather than redemptions, so nobody is told it is free and then charged.';
