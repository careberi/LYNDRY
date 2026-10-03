-- Provider progress is evidence, separate from local laundry receipt and billing.
alter table shipday_dispatch_plans add column if not exists provider_status text;
alter table shipday_dispatch_plans add column if not exists provider_checked_at timestamptz;
