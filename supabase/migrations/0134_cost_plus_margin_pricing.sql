-- Activate only the development quote policy. Saved order snapshots are unchanged.
insert into dev_pricing_policies(policy)
select policy || '{"pricingMethod":"COST_PLUS_MARGIN_15"}'::jsonb
from dev_pricing_policies where effective_at <= now() order by effective_at desc limit 1;
