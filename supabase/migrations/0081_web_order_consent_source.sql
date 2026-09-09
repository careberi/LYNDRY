-- ---------------------------------------------------------------------------
-- 0081 — placing an order online is its own consent source
-- ---------------------------------------------------------------------------
--
-- Neil, looking at a customer page: "I should be able to see how this person
-- signed up. Was it via Facebook? Was it via place an online order, or was it
-- through the regular, they gave us their number?"
--
-- Five of the six existing sources already answer that. The one that did not is
-- WEB_SIGNUP, which the deleted /signup form used AND which the new online
-- order flow inherited — so the one door he named specifically was the one
-- value that could mean two different things.
--
-- The same reasoning already keeps WEB_BERGEN out of WEB_HERO: an audit asks
-- HOW consent was obtained, and "somebody filled in the signup form" is not the
-- same story as "somebody placed an order and ticked the box on the address
-- step, immediately before the first text we ever sent them".
--
-- OLD ROWS ARE NOT REWRITTEN. The one historical WEB_SIGNUP is from the form
-- that used to exist, and it is honest about that. A record edited to fit
-- today's rules is not a record — the same reason bag_labels still allows a
-- sticker numbered 4.
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
      'DOOR_HANGER'
    ])
  );
