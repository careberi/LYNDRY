-- Record WHERE a customer's texting consent came from.
--
-- There is now more than one way to opt in, and a carrier audit does not ask
-- "did they consent", it asks "show me how". Until now every row came from the
-- signup form, so the answer was implied by the column existing at all. That
-- stops being true the moment the home page can start a conversation.
--
-- The three sources, and what the evidence actually is in each case:
--
--   WEB_SIGNUP   the full signup form. A ticked box, plus a timestamp and IP.
--   WEB_HERO     the phone field on the home page. Same box, same wording,
--                same timestamp and IP - just fewer other fields alongside it.
--   INBOUND_TEXT they texted us first, with no web form involved. The evidence
--                is their own message sitting in the messages table. Arguably
--                the strongest of the three: they started it.
--
-- Nullable, because every row that already exists predates this and came from
-- the signup form. Backfilled below rather than left null, so the column can
-- be trusted without having to know when it was added.

alter table customers
  add column if not exists sms_consent_source text;

alter table customers
  drop constraint if exists customers_sms_consent_source_check;

-- A CHECK constraint rather than a Postgres enum, so adding a fourth source
-- later is a one-line change instead of a type migration.
alter table customers
  add constraint customers_sms_consent_source_check
  check (sms_consent_source is null
         or sms_consent_source in ('WEB_SIGNUP', 'WEB_HERO', 'INBOUND_TEXT'));

-- Everyone who already consented did it on the signup form - it was the only
-- door there was.
update customers
   set sms_consent_source = 'WEB_SIGNUP'
 where sms_consent_at is not null
   and sms_consent_source is null;

comment on column customers.sms_consent_source is
  'Which door the customer opted in through. Paired with sms_consent_at and '
  'sms_consent_ip, this is the whole consent record a carrier would ask to see.';
