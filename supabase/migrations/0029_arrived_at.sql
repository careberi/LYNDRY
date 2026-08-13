-- ---------------------------------------------------------------------------
-- 0029 — "I'm here."
--
-- The guided run walks a driver through one stop at a time: go here, tap when
-- you arrive, do the thing, on to the next. Everything in that sequence is
-- already derivable from the order except one moment - whether he is standing
-- at the door yet.
--
-- IT IS TRANSIENT, AND IT IS CLEARED WHEN THE STEP COMPLETES. `arrived_at`
-- means "the driver is at this order's next stop right now", not "the driver
-- arrived at 9:14 on Tuesday". The same order is arrived at more than once in
-- its life - the customer's door to collect it, the laundromat to drop it, the
-- door again to deliver it - and one column cannot hold three different
-- arrivals. Anything that completes a step clears it, so the next stop starts
-- from "go here" again.
--
-- If a lasting record of arrival times is ever wanted, that is order_events,
-- which is append-only and already logs every step with a timestamp. This
-- column is a flag, not history, and must not be read as history.
--
-- Not storing it at all was the first version: "I'm here" would have been a
-- query string on the redirect. That loses the state the moment a phone locks
-- or a browser tab is reclaimed, which on a driver's phone in a stairwell is
-- most of the time - he would come back to "go to this location" while
-- standing in the hall holding the bag.
-- ---------------------------------------------------------------------------

alter table orders add column if not exists arrived_at timestamptz;

comment on column orders.arrived_at is
  'Transient: the driver is at this order''s next stop right now. Cleared when '
  'the step completes, because the same order is arrived at several times in '
  'its life. Not a history of arrivals - that is order_events.';
