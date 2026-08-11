-- Remember what time of day the customer asked for.
--
-- Until now an order stored only a day, so "can you come tomorrow at 6" lost
-- the "at 6" completely — the driver saw a date and nothing else, and the
-- customer got a confirmation that quietly ignored half of what they said.
--
-- Nullable on purpose. Plenty of people say "tomorrow" and mean it, and having
-- no preference is a real answer rather than missing data. Orders booked
-- before this migration keep a null here and read as "any time".
--
-- Stored as the time they ASKED for, not the window we quote back. The window
-- is arithmetic around this number and lives in one constant in
-- src/core/booking.js, so widening or tightening it is a one-line change and
-- never has to be backfilled here.

alter table orders
  add column if not exists pickup_time time;

comment on column orders.pickup_time is
  'The time of day the customer asked for, or null if they did not say. The '
  'quoted arrival window is derived from this in src/core/booking.js.';
