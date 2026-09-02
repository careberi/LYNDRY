-- ---------------------------------------------------------------------------
-- HOW OFTEN A LAUNDROMAT INVOICES US, AND HOW LONG WE HAVE TO PAY.
--
-- Neil, asked how invoicing should be described: "we should be able to select
-- how I see it - weekly, daily, biweekly, monthly - and we're gonna pay on
-- fifteen day terms."
--
-- PER PARTNER, not one global setting, because it is agreed with each one
-- separately and a second laundromat will not necessarily want the same cycle
-- as the first.
--
-- BIWEEKLY and 15 days are the defaults because they are what Neil works to
-- today. Nothing is derived from these yet - they are what the reconciliation
-- report groups by and what the laundromat page describes - so a wrong value
-- costs a mis-grouped report rather than a mis-paid invoice.
-- ---------------------------------------------------------------------------

alter table partners add column if not exists billing_period text
  not null default 'BIWEEKLY'
  check (billing_period in ('DAILY','WEEKLY','BIWEEKLY','MONTHLY'));

alter table partners add column if not exists payment_terms_days integer
  not null default 15
  check (payment_terms_days between 0 and 120);

comment on column partners.billing_period is
  'How often this laundromat invoices us. Per partner, agreed with each one.';

comment on column partners.payment_terms_days is
  'Days from invoice to payment. 15 by default, the terms Neil works to.';
