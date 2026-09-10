-- ---------------------------------------------------------------------------
-- 0083 — somebody rang us and we set them up
-- ---------------------------------------------------------------------------
--
-- Neil, 10 September: "I'm gonna start taking phone calls. So somebody doesn't
-- have to answer by text or go on the website. They can just literally call my
-- number and place an order."
--
-- Everything needed to do that already exists except the record of HOW it
-- happened. booking.bookPickup() writes the order, onboarding creates the
-- customer, billing.setupLinkMessage() texts the card link. What this adds is
-- the paperwork: a consent source that says a person spoke to them, and the
-- name of the person who took the call.
--
-- WHY A PHONE CALL IS ITS OWN CONSENT SOURCE, and not folded into an existing
-- one. Every other source is evidence somebody can look at afterwards: a
-- ticked box with a timestamp and an IP, or the customer's own inbound message
-- sitting in the messages table. A phone call leaves NEITHER. The only record
-- that consent was given is that a member of staff says it was.
--
-- That is weaker evidence and the schema should say so rather than dress it up
-- as a form submission. WEB_HERO on a row means "we can show you the box they
-- ticked". PHONE_CALL means "Neil says they asked us to text them", which is
-- lawful and ordinary and is also the thing a carrier or a regulator would
-- want named honestly. Same reasoning that keeps WEB_BERGEN out of WEB_HERO
-- and put WEB_ORDER in as its own value in 0081.
--
-- SO WE RECORD WHO TOOK THE CALL. sms_consent_by is the ops user who typed the
-- row, and it is the whole of the audit trail for these customers - "who says
-- this person agreed" has an answer with a name on it. Set null rather than
-- cascade when somebody leaves, exactly like every other record of who did
-- what: losing the person must not lose the fact.
-- ---------------------------------------------------------------------------

alter table customers
  drop constraint if exists customers_sms_consent_source_check;

alter table customers
  add constraint customers_sms_consent_source_check
  check (
    sms_consent_source is null
    or sms_consent_source = any (array[
      'WEB_SIGNUP',
      'WEB_ORDER',
      'WEB_HERO',
      'WEB_BERGEN',
      'INBOUND_TEXT',
      'FACEBOOK_FORM',
      'DOOR_HANGER',
      'PHONE_CALL'
    ])
  );

alter table customers
  add column if not exists sms_consent_by uuid references ops_users (id) on delete set null;

comment on column customers.sms_consent_by is
  'Who took the call, for customers created by hand from a phone order. Null '
  'for every other consent source, where the evidence is a ticked box or the '
  'customer''s own inbound message rather than a member of staff saying so.';

-- ---------------------------------------------------------------------------
-- Which orders were placed by a person on the phone.
--
-- booking.DOORS already decides the VOICE of the confirmation text - "Of
-- course!" is right when they asked over text and wrong when nobody asked at
-- all. That is a per-message decision made at send time and nothing kept it.
--
-- This keeps it, because the question "how did this order get here" outlives
-- the sentence. It is also the only way to answer whether taking calls is
-- working, which is the whole reason Neil is doing it.
-- ---------------------------------------------------------------------------
alter table orders
  add column if not exists placed_via text
  check (placed_via is null or placed_via in ('THREAD', 'WEB', 'PHONE'));

alter table orders
  add column if not exists placed_by uuid references ops_users (id) on delete set null;

comment on column orders.placed_via is
  'Which door the order came through. Null on orders written before this '
  'column existed - unknown, rather than assumed to be any particular one.';

comment on column orders.placed_by is
  'The ops user who took the call, for PHONE orders. Null everywhere else.';
