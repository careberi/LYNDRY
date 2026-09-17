-- WHO PUT THEM BACK ON THE LIST, AND WHEN.
--
-- Neil, 17 September: "If they are opted out: Opted out of texts, plus Opt back
-- in... Opt back in from ops is allowed when I press the button."
--
-- THAT REVERSES A RULE THIS SYSTEM HAS HAD SINCE THE OPT-OUT BUTTON WAS BUILT.
-- It read: nothing here opts anybody back IN, because consent is theirs to give
-- and they give it by texting START from their own handset. Neil has taken the
-- opposite view, deliberately and in writing, and it is his decision to take.
--
-- SO THE RECORD HAS TO CARRY IT, which is the whole of this migration.
-- Migration 0076 added unsubscribed_via, unsubscribed_at and unsubscribed_by on
-- the reasoning that an audit asks HOW consent moved, not just where it ended
-- up. Consent moving back is the same question from the other side, and it is
-- the more sensitive direction: somebody who asked not to be texted is being
-- put back on the list by us rather than by them.
--
-- Without these two columns an opt-back-in leaves no trace at all - the row
-- simply looks as though it was never opted out - and "who did that, and when"
-- is the first question anybody would ask.
--
-- NOTHING HERE IS A CONSENT RECORD AND IT MUST NOT BECOME ONE.
-- customers.sms_consent_at / sms_consent_source / sms_consent_ip are the
-- evidence that THEY agreed, and nothing on this path may write them: pressing
-- a button in ops is not the customer agreeing to anything. What these columns
-- say is narrower and true - a named person here decided to start texting them
-- again on this date.
--
-- STOP IS UNTOUCHED. It is handled in src/core/compliance.js before the AI ever
-- sees a message, on every number, and notify.sendAndLog() still refuses an
-- opted-out number at the last gate. A customer can always take themselves back
-- off, whatever anybody here pressed.

alter table customers
  add column if not exists resubscribed_at timestamptz;

alter table customers
  add column if not exists resubscribed_by uuid references ops_users(id);

comment on column customers.resubscribed_at is
  'When somebody in ops put this number back on the list after an opt-out. NOT '
  'a consent record - sms_consent_at is that - only the record of an ops '
  'decision. Null for everybody who was never opted out, and for anybody who '
  'came back by texting START themselves.';

comment on column customers.resubscribed_by is
  'Which ops_users row pressed Opt back in. Null when it was a machine key or '
  'when they opted back in themselves with START.';
