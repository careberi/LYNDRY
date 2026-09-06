-- ---------------------------------------------------------------------------
-- 0062 — who wrote an outbound message.
--
-- THE PROBLEM. Everything we send a customer is logged as OUTBOUND, whether
-- the AI wrote it, a status change sent it, or a person typed it into the
-- conversation screen. The AI is handed the last ten messages before it
-- replies, and every one of those outbound lines reads to it as something IT
-- said.
--
-- That is wrong in a specific and expensive way. An admin switches the AI off,
-- handles a complaint by hand - "really sorry, I'll get that looked at and come
-- back to you today" - and switches the AI back on. The next message from the
-- customer, the AI reads that promise as its own, and either repeats it,
-- contradicts it, or answers as though the last four messages were its own work
-- and the thread is going fine.
--
-- So an outbound message now records the person who wrote it, when a person
-- wrote it. Null means nobody typed it: the AI, a status text, a booking
-- confirmation. That one distinction is all the AI needs to stop taking credit
-- for somebody else's sentence.
--
-- NOT SET BY THE TEXT BLAST, deliberately. A blast is written by a person but
-- it is not somebody handling a conversation, and marking it as one would tell
-- the AI that every customer who got a promotion text is being dealt with by
-- hand.
-- ---------------------------------------------------------------------------

alter table messages
  add column if not exists sent_by uuid references ops_users(id) on delete set null;

comment on column messages.sent_by is
  'The person who typed this message into the conversation screen. Null when '
  'nobody did - the AI, a status text, a booking confirmation, a text blast. '
  'Read by the AI so it can tell a colleague''s words from its own.';
