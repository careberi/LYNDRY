-- WHICH FIELD AN OUTBOUND MESSAGE ASKED FOR.
--
-- Neil's brief, 16 September, rule 23: a row on the intake table that has been
-- asked about and not yet answered says "Asked - awaiting reply" rather than
-- looking as though nothing has been done. Without it the screen invites the
-- same question four times in a morning.
--
-- THIS IS NOT AN INTAKE-STAGE COLUMN, which the same brief rules out and which
-- this codebase refuses everywhere else. It is a label on ONE OUTBOUND MESSAGE
-- saying what that message asked for - a fact about something we DID, in the
-- same family as orders.reminder_sent_at, customers.card_link_sent_at and
-- orders.payment_chase_sent_at. Nothing derives a customer's state from it; the
-- state is still derived from the real values on the customer and the order,
-- every time the table is drawn. All this answers is "have we asked yet".
--
-- WHY IT CANNOT BE DERIVED FROM THE TEXT. CLAUDE.md already makes this argument
-- for the pickup reminder: "the nearest derivation is searching `messages` for
-- a sentence that looks like a reminder, which breaks the first time the
-- wording changes". Here the wording is MEANT to change - the whole point of
-- the composer is that an admin edits the sentence before sending it - so
-- matching on text would be a rule that works until somebody uses the feature.
--
-- NULL IS THE ORDINARY STATE and means "this message was not one of these
-- questions". Every message ever sent is one of those, which is correct.

alter table messages
  add column if not exists asked_for text;

-- A CHECK RATHER THAN A FREE STRING, which is the house style for every other
-- constrained text column here. It is ten values a person types into a form,
-- and a typo that silently becomes a label nothing ever matches would leave a
-- row permanently reading "asked" with no way to notice. Adding a field to the
-- intake table means adding a value here, on purpose.
alter table messages
  drop constraint if exists messages_asked_for_check;

alter table messages
  add constraint messages_asked_for_check
  check (
    asked_for is null
    or asked_for in (
      'name',
      'address',
      'pickup_date',
      'pickup_time',
      'pickup_location',
      'water_temp',
      'fabric_softener',
      'service_type',
      'frequency',
      'card'
    )
  );

comment on column messages.asked_for is
  'Which intake field this outbound message asked the customer for, or null for '
  'everything that was not one of those questions. A label on what we sent, not '
  'a state the customer is in - see src/core/intake.js.';

-- Read by phone, walking backwards from the newest message to the customer''s
-- last word. `messages` is already indexed by phone and created_at for the
-- conversation screen, so nothing new is needed here.
