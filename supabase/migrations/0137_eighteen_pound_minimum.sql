-- New development quotes freeze the inclusive 18 lb price as their dollar minimum.
-- Existing snapshots and the database billing function retain their saved terms.
insert into dev_pricing_policies(policy)
select policy || '{"minimumWeightLb":18,"minimumTotalCents":0}'::jsonb
from dev_pricing_policies where effective_at<=now() order by effective_at desc limit 1;
