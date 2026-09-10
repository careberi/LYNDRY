-- ---------------------------------------------------------------------------
-- 0084 — somebody texted a thread the AI is switched off on
-- ---------------------------------------------------------------------------
--
-- Neil, 10 September: "when a customer texts with AI turned off in the chat,
-- text me... and tells me that a customer with AI turned off in the chat has
-- texted you."
--
-- This closes a hole CLAUDE.md already names. The AI pause is deliberate and
-- total: an admin takes a conversation over and the AI says NOTHING until they
-- hand it back, not a holding line, not an apology. That is exactly right while
-- somebody is watching, and it is the whole risk of a switch that stays where
-- you put it - "a muted thread is a customer nobody is answering at all". The
-- thread is badged and counted on the conversations list precisely because
-- forgetting is the failure mode. Nothing pushed.
--
-- WHY A STORED TIMESTAMP RATHER THAN A DERIVATION. Everything about the pause
-- itself is already on this row, and "have we told an admin about this yet" is
-- a fact about something WE did, with no other home. The nearest derivation is
-- searching outbound messages to admins for a sentence that looks like one of
-- these, which breaks the first time the wording changes - the same reasoning
-- that put reminder_sent_at on orders rather than deriving it.
--
-- WHAT IT IS FOR IS NOT SPAM, AND THAT IS THE POINT. A customer on a paused
-- thread who sends four messages over an afternoon must not produce four texts;
-- an admin who is paged constantly stops reading the pages. The rule in
-- src/core/paused-alerts.js reads this column with two others it does NOT
-- store: whether a person has written to that number since, and how long ago
-- this was. Handled and then texted again tomorrow is news; texted again nine
-- minutes later is not.
-- ---------------------------------------------------------------------------

alter table ai_pauses
  add column if not exists alerted_at timestamptz;

comment on column ai_pauses.alerted_at is
  'When an admin was last texted that somebody wrote to this number while the '
  'AI was switched off on it. Null means never. Read together with whether a '
  'person has replied since - see src/core/paused-alerts.js.';
