-- ---------------------------------------------------------------------------
-- 0076 — how somebody came to be opted out, not just that they are.
--
-- customers already records how consent was GIVEN - sms_consent_at, _ip and
-- _source - because an audit asks how, not just whether. Withdrawal had none of
-- that: status went to UNSUBSCRIBED and nothing said when, or by what means.
--
-- It got away with it because there was only one way in. Somebody texted STOP,
-- and their own message sat in `messages` as the evidence. Neil has asked to be
-- able to mark somebody opted out from the ops screens - they rang up, or said
-- so at a door - and that leaves no message anywhere. Without these columns the
-- only trace would be a status that changed itself.
--
--   STOP      they texted it. compliance.js handles it before the AI ever sees
--             the message, and their text is still the primary evidence.
--   BY_HAND   somebody here recorded what a customer told them another way.
--             unsubscribed_by is who, and the note is what they were told.
--
-- ONE WAY, DELIBERATELY. Nothing here lets an ops user opt somebody back IN.
-- That is the customer's to give and they give it by texting START from their
-- own handset, which is the rule the rest of the system already follows.
-- ---------------------------------------------------------------------------

alter table customers
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists unsubscribed_via text
    check (unsubscribed_via is null or unsubscribed_via in ('STOP', 'BY_HAND')),
  add column if not exists unsubscribed_by uuid references ops_users (id) on delete set null,
  add column if not exists unsubscribed_note text;

-- Everybody already unsubscribed got there by texting STOP - it was the only
-- door. The timestamp is genuinely unknown, so it stays null rather than being
-- invented: a made-up date on a consent record is worse than an absent one.
update customers
   set unsubscribed_via = 'STOP'
 where status = 'UNSUBSCRIBED' and unsubscribed_via is null;

comment on column customers.unsubscribed_via is
  'How they came to be opted out: STOP (they texted it, and their message is '
  'the evidence) or BY_HAND (somebody here recorded what they were told). '
  'Nothing opts anybody back in - that is theirs to do by texting START.';
