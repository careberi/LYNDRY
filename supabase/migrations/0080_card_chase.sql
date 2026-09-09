-- ---------------------------------------------------------------------------
-- 0080 — the card link waits half an hour
-- ---------------------------------------------------------------------------
--
-- Neil: "After you add an address, a text goes out reminding the person to put
-- a card on file. This should not go out unless an order is booked and no card
-- is on file for 30 minutes."
--
-- He is right, and the website is where it reads worst: the card button is on
-- the screen in front of them, and a text arrives telling them to do the thing
-- they are already doing. Most people save a card within the minute, so most
-- of those texts were for nothing - and every one is a billed segment and a
-- line in a thread.
--
-- WHY THIS IS STORED RATHER THAN DERIVED. "Did we already send it" is a fact
-- about something we DID. The nearest derivation is searching `messages` for a
-- link that looks like a card link, which breaks the first time the wording
-- moves - and the token in it is different every time, so there is not even a
-- stable string to match. Exactly the reasoning behind orders.reminder_sent_at,
-- and this column earns its place the same way: it is what makes the sweep safe
-- to run every ten minutes for ever.
--
-- IT IS STAMPED AFTER THE SEND, NEVER BEFORE. A stamp that went first would
-- mark an order chased while the carrier was down, and nobody would ever be
-- told. Sent-but-unstamped costs one duplicate; stamped-but-unsent costs the
-- customer their pickup.
--
-- The AI stamps it too, at the moment it puts a link in its own reply, so the
-- sweep never sends a second copy of something a customer already has.
-- ---------------------------------------------------------------------------

alter table orders
  add column if not exists card_link_sent_at timestamptz;

-- The sweep asks one question every ten minutes: which orders are still
-- waiting on a card and have not been chased. Partial, because the answer is
-- almost always none and this keeps the index the size of that answer.
create index if not exists orders_card_chase_idx
  on orders (created_at)
  where card_link_sent_at is null;
