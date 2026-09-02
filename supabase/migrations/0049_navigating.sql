-- ---------------------------------------------------------------------------
-- 0049 — the driver has set off for this stop.
--
-- NEIL'S CALL: "Take me there" and "I'm here" were both live at once, and they
-- should be a sequence - directions first, arrival second.
--
-- It is not only tidiness. "I'm here" taps arrived_at, which is what unlocks
-- the tasks for that stop; a driver who can reach it without ever opening the
-- directions can confirm he has arrived somewhere he has not driven to, and
-- the screen will then walk him through collecting a bag at the wrong door.
--
-- WHY A COLUMN AND NOT A COOKIE. A cookie was the lighter answer and the wrong
-- one: lose it - different phone, cleared data, private tab - and the driver
-- can never tap "I'm here" at all. A hard block on a doorstep is far worse than
-- the problem being solved. On the order, everything that knows about the stop
-- can see it, and any device shows the same state.
--
-- IT IS A FLAG, NOT HISTORY, exactly like arrived_at beside it. The same order
-- is navigated to several times in its life - out to the door, on to the
-- laundromat, back to the door - so one column cannot hold three journeys.
-- Anything that clears arrived_at clears this too. If lasting movement times
-- are ever wanted, that is order_events.
-- ---------------------------------------------------------------------------

alter table orders add column if not exists navigating_at timestamptz;

comment on column orders.navigating_at is
  'When the driver opened the directions for this order''s next stop. Gates '
  '"I''m here" so arrival cannot be confirmed at a place nobody drove to. A '
  'flag, not history: cleared alongside arrived_at whenever a stop completes.';
