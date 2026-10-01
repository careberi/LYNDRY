-- Customer pricing is independent of what a laundromat invoices LYNDRY.
alter table partners add column customer_base_per_lb_cents integer
  check (customer_base_per_lb_cents is null or customer_base_per_lb_cents > 0);
comment on column partners.customer_base_per_lb_cents is
  'Customer quote base before category margin and processing. NULL falls back to wholesale. Never a partner payable rate.';
-- Preserve current customer prices while making the base independently editable.
update partners set customer_base_per_lb_cents=wholesale_per_lb_cents
where type='LAUNDROMAT' and wholesale_per_lb_cents > 0;
