-- ---------------------------------------------------------------------------
-- 0072 — leads from the Facebook instant form.
--
-- Neil runs ads with a Meta instant form; the leads land in a Google Sheet.
-- This is the record of which of them we have seen and which we have texted,
-- so the sweep can run every few minutes and never text anybody twice.
--
-- KEYED ON META'S OWN LEAD ID, not on the phone number. One person can fill
-- the form twice - from two ads, or by accident - and the second row is a new
-- lead about a number we already have. Keying on the lead id records both
-- honestly; keying on the phone would silently lose one.
--
-- WHY A TABLE RATHER THAN DERIVING IT. "Have we texted this lead" is a fact
-- about something we DID, exactly like orders.reminder_sent_at, and the
-- alternative is asking whether a customer exists - which is not the same
-- question and gets the wrong answer for anybody who was already a customer
-- before they filled the form in.
--
-- consented IS COPIED FROM THE FORM AND IS THE WHOLE GATE. The instant form
-- carries a tick box - "I agree to receive text messages from lyndry" - and
-- three of the first four leads left it FALSE. That box is the consent record
-- a carrier asks about, so a false is a number we may not text. It is stored
-- rather than only acted on, because the answer to "why did we never contact
-- this person" has to survive.
-- ---------------------------------------------------------------------------

create table if not exists facebook_leads (
  -- Meta's id, e.g. l:1385400376502562. Theirs, not ours.
  lead_id      text primary key,

  phone        text not null,
  created_time timestamptz,

  -- What they ticked on the form. Null when the column was missing entirely,
  -- which is treated exactly like false: we do not text somebody on a guess.
  consented    boolean,

  form_name    text,
  campaign     text,

  -- When the sweep first saw the row, and when we texted them. texted_at null
  -- with a reason means we deliberately did not.
  seen_at      timestamptz not null default now(),
  texted_at    timestamptz,
  skipped      text,

  customer_id  uuid references customers (id) on delete set null
);

create index if not exists facebook_leads_untexted_idx
  on facebook_leads (seen_at) where texted_at is null;

alter table facebook_leads enable row level security;

-- --- A fifth way to consent ------------------------------------------------
--
-- CLAUDE.md records that an audit asks HOW consent was obtained, not just
-- whether. A tick box on a Meta lead form is its own kind of evidence and
-- deserves its own name.
alter table customers
  drop constraint if exists customers_sms_consent_source_check;

alter table customers
  add constraint customers_sms_consent_source_check
  check (sms_consent_source is null
         or sms_consent_source in ('WEB_SIGNUP', 'WEB_HERO', 'WEB_BERGEN',
                                   'INBOUND_TEXT', 'FACEBOOK_FORM'));

comment on table facebook_leads is
  'Leads from the Meta instant form, synced from a Google Sheet. Keyed on '
  'Metas lead id so the same person filling the form twice is two honest rows. '
  'consented is the tick box from the form and is the gate on texting them.';
