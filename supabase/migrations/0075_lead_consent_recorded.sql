-- ---------------------------------------------------------------------------
-- 0075 — the tick box on the lead form is recorded, not enforced.
--
-- Nothing about the schema changes here. This corrects a comment that became
-- untrue one day after it was written, which matters because the comment is
-- what the next person reads before deciding whether the code is broken.
--
-- 0072 said consented was "the gate on texting them", and it was. Neil changed
-- it: "if they provided the number we text them". The column is still written
-- on every row and is still the evidence - which of these people actually
-- ticked it is the first question anybody would ask if this is ever challenged,
-- and that answer must survive the policy changing.
--
-- The reasoning on both sides is in src/core/leads.js, at length, because the
-- instinct on reading that file is to put the gate back.
--
-- What still refuses, and is not a preference: a number that has texted STOP.
-- ---------------------------------------------------------------------------

comment on table facebook_leads is
  'Leads from the Meta instant form, synced from a Google Sheet. Keyed on '
  'Metas lead id so the same person filling the form twice is two honest rows.';

comment on column facebook_leads.consented is
  'What they ticked on the forms consent box. RECORDED, NOT ENFORCED - Neils '
  'call, see src/core/leads.js. It is the evidence of how each lead answered '
  'and is kept whether or not it decides anything.';

comment on column facebook_leads.skipped is
  'Why this lead was not texted, when it was not. A lead we chose to leave '
  'alone and one we never saw are different answers, and both have to survive.';
