-- 0104_courier_event_kind.sql
--
-- `COURIER` JOINS THE LIST OF THINGS THAT CAN HAPPEN TO AN ORDER.
--
-- Booking a courier to take a finished order back to the customer is a change to
-- that order and belongs in its change log with a name against it, exactly like
-- a weight or a status move. It was being written and silently thrown away.
--
-- IT FAILED INVISIBLY, WHICH IS THE PART WORTH RECORDING. `orderEvents.record()`
-- swallows its own errors and logs loudly, deliberately - CLAUDE.md's rule that
-- recording must never break the thing being recorded, because a driver at a
-- door must not be stopped by the audit trail failing. The cost of that rule is
-- exactly this: a `kind` the CHECK constraint does not allow looks like nothing
-- at all from the caller's side. The courier was booked, the row in
-- `courier_deliveries` was written, and the order's change log said nothing.
--
-- Migration 0028 called itself "a two-line migration instead of a painful one"
-- for precisely this reason. This is the second time it has been right.

alter table order_events drop constraint if exists order_events_kind_check;

alter table order_events add constraint order_events_kind_check
  check (kind in (
    'CREATED', 'STATUS', 'WEIGHT', 'PRICE', 'PAYMENT', 'REFUND',
    'LABEL', 'PARTNER', 'PARTNER_WEIGHT', 'NOTE', 'CANCELLED', 'SCHEDULE',
    'DRIVER', 'COURIER'
  ));
