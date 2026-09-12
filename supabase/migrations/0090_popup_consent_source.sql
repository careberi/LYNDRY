-- ---------------------------------------------------------------------------
-- 0090 — the popup is its own door, so it is its own consent source
-- ---------------------------------------------------------------------------
--
-- The popup added in 0089 is a second box on the same pages as the hero form.
-- It could have shared WEB_HERO and nobody would have noticed for a while.
--
-- It gets its own value for the reason this column exists at all: an audit asks
-- HOW consent was obtained, not only whether it was, and "a popup that appeared
-- over the page" and "the form in the middle of the page" are different
-- answers. It is the same reason WEB_BERGEN is not folded into WEB_HERO and the
-- same reason DOOR_HANGER records which door.
--
-- It also happens to answer the first question anybody will ask about a popup,
-- which is whether it is worth having. That is a side effect and not the
-- justification: the evidence is.
--
-- Adding a value here means adding it to CONSENT_SOURCES in
-- src/core/onboarding.js too. That list refuses an unknown source with a
-- sentence naming it, because the constraint below refuses it with an error
-- nobody can read.
-- ---------------------------------------------------------------------------

alter table customers
  drop constraint if exists customers_sms_consent_source_check;

alter table customers
  add constraint customers_sms_consent_source_check
  check (
    sms_consent_source is null
    or sms_consent_source in (
      'WEB_SIGNUP',
      'WEB_ORDER',
      'WEB_HERO',
      'WEB_BERGEN',
      'WEB_POPUP',
      'INBOUND_TEXT',
      'FACEBOOK_FORM',
      'DOOR_HANGER',
      'PHONE_CALL'
    )
  );
