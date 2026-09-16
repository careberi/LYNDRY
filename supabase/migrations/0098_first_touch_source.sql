-- ---------------------------------------------------------------------------
-- 0098 — how a customer first reached us, in one word
-- ---------------------------------------------------------------------------
--
-- Neil, 16 September, finishing the Google paid-conversion feed: the two
-- offline conversions are uploaded once per customer who carries a Google click
-- id, and there is a whole class of customer the ads bought who never carries
-- one.
--
-- THE MESSAGE ASSET IS THE HOLE. A Google search ad can show a "Book now"
-- message button that opens the phone's SMS app with our number and a starter
-- text already typed. Somebody who taps it never loads lyndry.com at all, so
-- there is no landing URL, no gclid, no cookie and nothing for `0085` to
-- capture - they simply appear in the thread. Those are ad clicks we are paying
-- for and could not report on.
--
-- WHAT IDENTIFIES THEM IS THE STARTER TEXT ITSELF. Google types it, so a first
-- inbound message that is exactly that sentence is a tap on that button and
-- almost nothing else. It is recorded here, once, when the conversation starts.
--
-- NOT A SECOND COPY OF `sms_consent_source`. That column answers HOW CONSENT
-- WAS OBTAINED and is a legal record - INBOUND_TEXT is the honest answer for
-- one of these people and must not become 'GOOGLE_AD'. This answers WHICH
-- MARKETING BROUGHT THEM, which is a different question with a different
-- consumer, and folding the two would corrupt the consent record to serve an
-- advertising report.
--
-- FIRST TOUCH, LIKE THE CLICK IDS. Written once and never overwritten: the
-- thing worth crediting is what brought them in, not what they did later. Null
-- for everybody who did not arrive through a channel we can name, which is most
-- of them, and for everybody created before this existed.
--
-- IT IS A REPORTING COLUMN AND NOTHING BRANCHES ON IT. No price, no permission
-- and no message depends on it. If it is wrong, a number in a report is wrong.
-- ---------------------------------------------------------------------------

alter table customers
  add column if not exists first_touch_source text;

comment on column customers.first_touch_source is
  'Which marketing first reached this customer, when we can name it. '
  '''google_ad_text'' means their first inbound SMS was exactly the starter '
  'text on a Google message-asset ad, which is the only trace those clicks '
  'leave - they never load the website, so they carry no gclid. First touch; '
  'never overwritten. Reporting only: nothing branches on it.';

-- The conversion feed reads "every customer we can attribute", which is a click
-- id or this column. Small table, but this is the whole where-clause.
create index if not exists customers_first_touch_source_idx
  on customers (first_touch_source)
  where first_touch_source is not null;
