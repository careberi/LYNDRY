-- ---------------------------------------------------------------------------
-- 0070 — ai_pauses.paused must not default to true.
--
-- THE BUG, caught the moment the screen was looked at. ai_pauses was designed
-- when a row meant one thing: this number is paused. So `paused` defaulted to
-- true, because merely having a row WAS the pause.
--
-- 0069 gave the table a second job - follow_ups_off - and the two collided.
-- Turning chases off for a number with no existing row INSERTED one, `paused`
-- took its default, and the AI silently stopped answering that customer
-- altogether. A switch that says "do not chase this one" had quietly done the
-- much bigger thing.
--
-- paused_at is not-null, so it keeps its stamp rather than being cleared; the
-- row simply reads "was paused at X, is not now", which is honest and is what
-- resume() already leaves behind.
--
-- The default is now false. Nothing relies on it: aiPause.pause() has always
-- set paused: true explicitly and resume() sets it false, so the only writer
-- that ever leant on the default was the new one that should not have.
--
-- A row in this table now means "there are settings for this number", not
-- "this number is paused" - which is what it has actually meant since 0069.
-- ---------------------------------------------------------------------------

alter table ai_pauses alter column paused set default false;

comment on column ai_pauses.paused is
  'Whether the AI is switched off for this number entirely. A row existing '
  'does NOT mean paused - the row may exist only to hold follow_ups_off - so '
  'this defaults to false and every writer sets it deliberately.';
