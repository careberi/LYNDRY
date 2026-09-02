-- ---------------------------------------------------------------------------
-- 0045 — the AI stops talking and waits for a person.
--
-- NEIL'S CALL, after watching it happen. When the AI repeats itself it has run
-- out of road, and everything it says after that point makes things worse: it
-- either says the same thing a third time or apologises, and either way the
-- customer now knows something is broken.
--
-- So it says NOTHING. The conversation is put on hold, an issue is raised, and
-- a person writes the next message themselves. To the customer there is simply
-- a pause and then a reply from LYNDRY - which is what happens at any small
-- business when somebody has to go and check something.
--
-- WHY A COLUMN RATHER THAN A DERIVED STATE. Almost everything else in this
-- system is derived rather than stored, and that is right where the underlying
-- fact already exists somewhere - where a driver is, what a partner is
-- holding. This one does not exist anywhere else: "a person has taken this
-- conversation over" is a decision, not a consequence, and there is nothing to
-- read it off. Deriving it from "an open issue exists" would also be wrong,
-- because most issues are questions for a person while the AI carries on
-- perfectly well around them.
--
-- HOW IT LIFTS. Not on a timer and not by anybody remembering. The hold ends
-- when a person has actually sent a message and the customer has answered it -
-- both halves, because a draft nobody sent is not a reply, and a reply nobody
-- responded to is not a conversation that has resumed. src/routes/sms.js does
-- that check on the way in.
-- ---------------------------------------------------------------------------

alter table issues add column if not exists ai_hold boolean not null default false;

-- Finding the hold for an inbound message is on the hot path of every text, so
-- it gets its own index rather than scanning every issue the customer ever had.
create index if not exists issues_ai_hold_idx
  on issues (customer_id) where status = 'OPEN' and ai_hold;

comment on column issues.ai_hold is
  'The AI has stopped replying to this customer and a person owes them the '
  'next message. Set when the AI repeats itself, which means it has run out of '
  'road. Cleared when a person has sent a message AND the customer has replied '
  'to it - both halves, because a draft nobody sent is not a reply.';
