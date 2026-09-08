-- ---------------------------------------------------------------------------
-- 0078 - a promotion can carry a scan code, for door hangers.
--
-- Neil is printing door hangers with a QR code on them. Scanning it opens the
-- customer's messaging app with a message already typed - "Hi LYNDRY - promo
-- D00R10" - and sending it is how they claim $10 off.
--
-- CLAUDE.md says plainly that a promotion is an object attached to a person and
-- not a code, and that rule still holds. What is different here is what the
-- code is FOR. On a door hanger there is no form, no landing page and no
-- website visit: a stranger's phone number arriving out of the blue is the only
-- thing we ever see, so a code in the first message is the only way to know
-- they came from a door in Ridgewood rather than from an advert. It is
-- attribution, not redemption. The instant it arrives the promotion attaches to
-- the person exactly as every other promotion does, and is never typed again -
-- there is still nothing to enter at booking and no link to click.
--
-- The code is stored as it is printed. Matching is done on a normalised form
-- (see src/core/promocodes.js) because D00R10 and DOOR10 are the same thing to
-- anybody reading it off a card in a doorway, and the whole point of printing
-- the code beside the QR is that it works when the camera does not.
-- ---------------------------------------------------------------------------

alter table promotions add column if not exists code text;

comment on column promotions.code is
  'Scan code printed on a door hanger. Matched case-insensitively with O read '
  'as 0 - see src/core/promocodes.js. Null for every promotion that is not '
  'claimed by texting a code.';

-- NORMALISED, NOT LITERAL. Two promotions coded DOOR10 and D00R10 would both
-- match the same message and the winner would be whichever row came back
-- first, which is not something anybody could debug from the outside.
create unique index if not exists promotions_code_unique
  on promotions (upper(replace(code, 'O', '0'))) where code is not null;

-- ---------------------------------------------------------------------------
-- CODE joins the audiences.
--
-- It has to be its own audience rather than reusing SPECIFIC, because the two
-- differ in who does the giving: SPECIFIC is Neil pressing a button on
-- somebody's profile, CODE is the customer claiming it themselves. Keeping it
-- out of NEW_NUMBERS is the part that matters most - that audience is granted
-- automatically to everybody who texts in, which is exactly what a door-hanger
-- promotion must not do.
-- ---------------------------------------------------------------------------

alter table promotions drop constraint if exists promotions_audience_check;

alter table promotions
  add constraint promotions_audience_check
  check (audience in ('NEW_NUMBERS', 'NEVER_ORDERED', 'EVERYONE', 'SPECIFIC', 'CODE'));

-- ---------------------------------------------------------------------------
-- DOOR_HANGER joins the consent sources.
--
-- The evidence is still their own inbound message, exactly as INBOUND_TEXT -
-- they texted us first and that message is in the messages table. What this
-- records is which door, the same reason WEB_BERGEN is separate from WEB_HERO:
-- an audit asks WHERE somebody came from, and "a card on their front door" is
-- a different answer from "they texted us out of the blue".
-- ---------------------------------------------------------------------------

alter table customers drop constraint if exists customers_sms_consent_source_check;

alter table customers
  add constraint customers_sms_consent_source_check
  check (sms_consent_source is null
         or sms_consent_source in ('WEB_SIGNUP', 'WEB_HERO', 'WEB_BERGEN',
                                   'INBOUND_TEXT', 'FACEBOOK_FORM', 'DOOR_HANGER'));

-- ---------------------------------------------------------------------------
-- The door hanger promotion itself.
--
-- Uncapped and with no expiry, both Neil's call: they went to the trouble of
-- scanning a card off their own front door, and a promise that quietly runs out
-- is worse at a doorstep than one that does not. Stop it from the promotions
-- page when the run of hangers is done.
--
-- FIRST_ORDER, because it is an offer to somebody who has never used us. The
-- $25 order minimum still applies and the discount comes off after it, so a
-- small first load costs $25 - $10 = $15 rather than nothing.
-- ---------------------------------------------------------------------------

insert into promotions (name, blurb, kind, value, applies_to, audience, code, status)
select
  'Door hanger - $10 off',
  '$10 off your first order',
  'AMOUNT_OFF',
  1000,
  'FIRST_ORDER',
  'CODE',
  'D00R10',
  'ACTIVE'
where not exists (
  select 1 from promotions where upper(replace(code, 'O', '0')) = 'D00R10'
);
