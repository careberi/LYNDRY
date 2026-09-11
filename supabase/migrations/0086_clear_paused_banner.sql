-- ---------------------------------------------------------------------------
-- 0086 — the "AI is switched off" banner can be cleared
-- ---------------------------------------------------------------------------
--
-- Neil, 11 September, looking at the banner on the conversations screen: "i
-- should have the ability to clear this notification". The one thread in it
-- was somebody he had already dealt with and who had since opted out, so the
-- banner was telling him about nothing and would do so for ever.
--
-- CLEARING HIDES THE BANNER, NOT THE SWITCH. The AI stays off, the row on the
-- list keeps its "AI off" badge, and the thread page is unchanged. What goes is
-- the warning at the top of the list.
--
-- A TIMESTAMP, NOT A FLAG, exactly like dismissed_leads. It says "I have seen
-- this as of now". The thread comes back into the banner if the customer texts
-- again afterwards, or if the AI is switched off again later - both of those
-- are news the banner exists to carry. A customer who writes to a muted thread
-- also still texts an admin (0084), so clearing the banner cannot hide one.
-- ---------------------------------------------------------------------------

alter table ai_pauses
  add column if not exists banner_cleared_at timestamptz,
  add column if not exists banner_cleared_by uuid references ops_users(id) on delete set null;

comment on column ai_pauses.banner_cleared_at is
  'When somebody cleared this thread out of the "AI is switched off" banner. '
  'It reappears if the customer texts after this, or the AI is paused again '
  'after it. See stillInBanner() in src/core/ai-pause.js.';
