-- ---------------------------------------------------------------------------
-- 0041 — where a customer came from, and no separate table for advert signups.
--
-- THERE IS NO WAITLIST TABLE, and there briefly was. The /bergen advert page
-- collects a number behind a consent box, and the first version put those rows
-- somewhere of their own on the reasoning that a stranger who saw an advert is
-- not yet a customer.
--
-- Neil's call, and it is the right one: they gave us their number, they ticked
-- the box, and we text them straight away. That is a customer. A parallel
-- table would have meant every count, every board and every "who have we got"
-- answer quietly disagreed with itself depending on which one it read - and
-- the day somebody joined from an advert and then texted us, they would have
-- existed twice.
--
-- So an advert signup is an ordinary customer row with WEB_BERGEN as its
-- consent source. The only thing that needed adding is which advert found
-- them.
-- ---------------------------------------------------------------------------

alter table customers add column if not exists utm_source   text;
alter table customers add column if not exists utm_medium   text;
alter table customers add column if not exists utm_campaign text;
alter table customers add column if not exists utm_content  text;

comment on column customers.utm_source is
  'Which campaign found this person, taken from the landing page query string '
  'and stamped ONCE, when the row is created. Never overwritten: first touch '
  'is the honest answer to "which advert found them", and rewriting it would '
  'let the last campaign somebody happened to click take the credit.';
