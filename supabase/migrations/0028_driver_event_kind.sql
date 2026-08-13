-- ---------------------------------------------------------------------------
-- 0028 — DRIVER joins the list of things that can happen to an order.
--
-- Orders now belong to a driver, assigned automatically and reassignable by
-- hand. "Who was supposed to collect this" is exactly the question asked after
-- one goes missing, so a change of hands has to be in the log with everything
-- else rather than being the one silent edit.
--
-- The list is a CHECK constraint on a text column rather than a Postgres enum
-- precisely so this is a two-line migration instead of a painful one.
-- ---------------------------------------------------------------------------

alter table order_events drop constraint if exists order_events_kind_check;

alter table order_events add constraint order_events_kind_check
  check (kind in (
    'CREATED', 'STATUS', 'WEIGHT', 'PRICE', 'PAYMENT', 'REFUND',
    'LABEL', 'PARTNER', 'PARTNER_WEIGHT', 'NOTE', 'CANCELLED', 'SCHEDULE',
    'DRIVER'
  ));
