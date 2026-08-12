-- Record the window a customer was actually promised.
--
-- Until now an order stored the time they ASKED for, and the window was
-- arithmetic around it. That was right when pickup could be at any minute of
-- the day. It stops being right the moment there are fixed windows, for one
-- reason: windows are configuration, and configuration changes.
--
-- If the window were derived at display time, moving the afternoon slot from
-- "3 to 6" to "2 to 5" next month would silently rewrite what an already
-- booked customer was told. They were promised 3 to 6 in a text message that
-- is sitting in their phone. So the promise is stored on the order.
--
-- pickup_time stays. It is still what they asked for, which is worth keeping:
-- it is the only record of whether our windows actually suit people, and it is
-- what a route planner would sort by inside a window.

alter table orders
  add column if not exists pickup_window_start time,
  add column if not exists pickup_window_end   time;

comment on column orders.pickup_window_start is
  'Start of the arrival window the customer was promised. Fixed at booking, '
  'because changing the configured windows later must not rewrite what an '
  'existing customer was already told.';

comment on column orders.pickup_window_end is
  'End of the promised arrival window. See pickup_window_start.';
