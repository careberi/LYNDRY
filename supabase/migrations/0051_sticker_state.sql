-- ---------------------------------------------------------------------------
-- 0051 — a sticker is in use, or it is finished.
--
-- NEIL'S CHANGE to the laundromat's page: the four stickers should show which
-- state each one is in - not applicable, in use, or done - and the attendant
-- should say explicitly when the whole order is finished rather than the
-- system inferring it.
--
-- Until now a sticker had two states and they were the same fact: a child row
-- existed or it did not, and "exists" meant "that bag is finished". That is
-- one state too few for the way the work actually goes. A sticker gets peeled
-- and stuck on a bag when that bag STARTS being packed; it is finished some
-- minutes later. Between those two moments the attendant has committed the
-- sticker and cannot un-commit it, and the page could not show that.
--
--   no row          not applicable - this tag did not become that many bags
--   row, no date    IN USE - the sticker is on a bag being worked on
--   row + date      DONE
--
-- WHY THE ORDER NO LONGER FINISHES ITSELF. It used to become READY the moment
-- every intake bag had one finished bag against it, which is an inference: it
-- assumes one bag in becomes one bag out and stops watching. The attendant is
-- the only person who knows whether they are still folding, so they say so.
--
-- The cost of that is real and worth naming: an attendant who never taps "this
-- order is done" leaves an order that never becomes ready, and nobody drives
-- out for it. The driver can still mark it ready from our own screens, which
-- is the backstop, and the order sits on the board the whole time rather than
-- disappearing.
-- ---------------------------------------------------------------------------

alter table bag_labels add column if not exists finished_at timestamptz;

comment on column bag_labels.finished_at is
  'When the laundromat marked this outgoing bag finished. Null on a sticker '
  'that has been peeled onto a bag but not completed - "in use". A row that '
  'does not exist at all means the sticker was never used, because this tag '
  'became fewer bags than four.';
