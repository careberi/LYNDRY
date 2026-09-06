-- ---------------------------------------------------------------------------
-- 0065 — what kind of message we sent.
--
-- THE FOLLOW-UP NEEDS TO KNOW WHY WE SPOKE LAST. Neil's ask: when the AI asks
-- somebody a question and they go quiet, chase it once, 24 hours later. That
-- means answering "was our last message the AI waiting on them?" - and every
-- outbound row looked identical.
--
-- messages.sent_by (0062) already separates a person's words from everything
-- else. This separates the rest:
--
--   AI         the AI's own reply in a conversation. The only kind that
--              earns a follow-up, because it is the only one where we are
--              waiting on an answer.
--   FOLLOW_UP  the chase itself. Kept apart from AI for one specific reason:
--              it is what makes a follow-up to a follow-up IMPOSSIBLE rather
--              than merely discouraged. The rule is "the last message must be
--              an AI reply", and after a chase the last message is a chase.
--   PERSON     typed into the conversation screen by a human.
--   SYSTEM     everything nobody is waiting on us for - booking
--              confirmations, status texts, reminders, STOP replies, the
--              nudge buttons, the blast, an apology after an error.
--
-- NULL MEANS WE DO NOT KNOW, and every row written before today is null. That
-- is the safe direction: the follow-up test requires kind = 'AI' explicitly, so
-- an unlabelled history can never trigger a chase at somebody who had a
-- conversation last week.
--
-- Inbound rows have no kind. Nothing sent them.
-- ---------------------------------------------------------------------------

alter table messages
  add column if not exists kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_kind_check'
  ) then
    alter table messages
      add constraint messages_kind_check
      check (kind is null or kind in ('AI', 'FOLLOW_UP', 'PERSON', 'SYSTEM'));
  end if;
end $$;

-- The follow-up sweep asks for AI messages in a recent window. Everything else
-- reads a whole thread at once and does not need this.
create index if not exists messages_kind_recent_idx
  on messages (kind, created_at)
  where kind is not null;

comment on column messages.kind is
  'What kind of outbound message this was: AI (a reply we are awaiting an '
  'answer to), FOLLOW_UP (the one chase we allow), PERSON (typed on the ops '
  'screen), SYSTEM (everything nobody owes us a reply to). Null on inbound '
  'rows and on everything written before this column existed.';
