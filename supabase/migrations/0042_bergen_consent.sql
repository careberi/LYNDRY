-- ---------------------------------------------------------------------------
-- 0042 — a fourth way to consent: the /bergen advert landing page.
--
-- Its own source rather than being folded into WEB_HERO, because an audit asks
-- WHICH page somebody ticked the box on, and "the page we were paying to send
-- them to" is a different answer from "the home page".
--
-- The wording of the box itself is identical on both, and that is the part
-- that must never differ - a carrier comparing the pages expects one sentence.
-- ---------------------------------------------------------------------------

alter table customers drop constraint if exists customers_sms_consent_source_check;

alter table customers
  add constraint customers_sms_consent_source_check
  check (sms_consent_source is null
         or sms_consent_source in ('WEB_SIGNUP', 'WEB_HERO', 'WEB_BERGEN', 'INBOUND_TEXT'));
