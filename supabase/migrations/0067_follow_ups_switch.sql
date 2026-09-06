-- ---------------------------------------------------------------------------
-- 0067 — a switch for the follow-up chases.
--
-- Neil's ask, and it is the same instinct as the closed sign: anything that
-- texts customers on its own needs a way to stop it that does not involve a
-- deploy. The AI chases an unanswered question once a day later, and that is
-- exactly the sort of thing you want off while you are testing, or while
-- something is going wrong, or on a week when the van is not running.
--
-- GLOBAL, not per thread, because per thread already exists: switching the AI
-- off for one conversation (ai_pauses) already stops its chase, since a chase
-- is the AI speaking. This is the other half - all of them, at once.
--
-- Default ON. The feature is worth having; the switch is for turning it off
-- deliberately, and a default of off would mean it silently never ran.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists follow_ups_on boolean not null default true;

comment on column app_settings.follow_ups_on is
  'Whether the AI chases unanswered questions a day later. Off stops every '
  'chase everywhere; switching the AI off for one conversation already stops '
  'that one. Nothing else about the AI changes - it still answers anybody who '
  'texts in.';
