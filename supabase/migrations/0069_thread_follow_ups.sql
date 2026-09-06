-- ---------------------------------------------------------------------------
-- 0069 — turn follow-ups off for ONE conversation.
--
-- Neil's case, from a real thread: the customer said "Not yet. Will LYK.
-- Thanks!", the AI said "Sounds good, no rush at all", and a chase was queued
-- for the next afternoon. The customer has already said they will come back.
-- Chasing them is exactly the wrong move, and there was no way to stop that one
-- without stopping every chase in the business.
--
-- THIS IS NOT THE AI PAUSE, and the difference matters. Pausing the AI stops it
-- SAYING ANYTHING at all on that number, which is what you want when a person
-- has taken the conversation over. This stops only the unprompted chase: the AI
-- still answers normally the moment they text in.
--
--   the pause        somebody has this one, hands off
--   follow-ups off   answer them as usual, just do not chase
--
-- It lives on ai_pauses because that table is already "the per-thread switches,
-- keyed by phone number" - one row per number, and the screen it belongs to is
-- a list of numbers. A second table keyed the same way would be a second place
-- to look for the same kind of answer.
--
-- Default false: chasing is on unless somebody turns it off here, or off
-- everywhere via app_settings.follow_ups_on.
-- ---------------------------------------------------------------------------

alter table ai_pauses
  add column if not exists follow_ups_off boolean not null default false;

alter table ai_pauses
  add column if not exists follow_ups_changed_at timestamptz;

alter table ai_pauses
  add column if not exists follow_ups_changed_by uuid references ops_users(id) on delete set null;

comment on column ai_pauses.follow_ups_off is
  'Stop the AI chasing an unanswered question on THIS number only. Not the '
  'same as paused: the AI still answers when they text in, it just never '
  'starts a conversation of its own. Use it when a customer has said they '
  'will come back to you.';
