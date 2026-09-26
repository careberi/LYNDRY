-- 0106_leg_carrier.sql
--
-- WHO DOES EACH LEG: A COURIER, OR ONE OF OURS.
--
-- Neil, 25 September: "There also needs for me to override a pickup/delivery
-- manually so i can assign a in house driver to it".
--
-- TWO COLUMNS, BECAUSE AN ORDER HAS TWO TRIPS AND THEY ARE DECIDED SEPARATELY.
-- A courier collects from the door and our own van brings it back; or the other
-- way round, because the courier refused the return, or because it is a customer
-- worth driving to, or because a laundromat rang up and the bags are late. One
-- column would force both legs to agree, and the whole reason this exists is
-- that sometimes they should not.
--
-- NULL IS THE ORDINARY STATE AND MEANS "WHATEVER THE MODEL DOES". Under the van
-- that is a driver; under the courier model it is a courier. Storing the default
-- would be a second copy of a fact `config.courier.model` already holds, and it
-- would go stale the day the model changes - every order taken before it would
-- claim a carrier chosen by nobody.
--
-- SO A VALUE HERE ALWAYS MEANS A PERSON DECIDED. That is the same shape as
-- `orders.partner_pinned_at`: the plan is derived, and the column records
-- somebody overruling it. Who and why live in `order_events`, which is where
-- every other override in this system is recorded, rather than in two more
-- columns per leg.

alter table orders add column if not exists pickup_carrier text;
alter table orders add column if not exists return_carrier text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_pickup_carrier_check') then
    alter table orders add constraint orders_pickup_carrier_check
      check (pickup_carrier is null or pickup_carrier in ('COURIER', 'DRIVER'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'orders_return_carrier_check') then
    alter table orders add constraint orders_return_carrier_check
      check (return_carrier is null or return_carrier in ('COURIER', 'DRIVER'));
  end if;
end $$;

comment on column orders.pickup_carrier is
  'Who collects from the customer: COURIER or DRIVER. Null means whatever the '
  'pricing model does by default, so a value here always means a person '
  'overruled it. Who and why are in order_events.';

comment on column orders.return_carrier is
  'Who takes the finished laundry back: COURIER or DRIVER. Decided separately '
  'from the pickup, because a courier can do one leg and not the other.';
