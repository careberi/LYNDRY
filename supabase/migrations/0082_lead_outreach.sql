-- ---------------------------------------------------------------------------
-- 0082 — the adverts stop texting, and a person starts calling
-- ---------------------------------------------------------------------------
--
-- Neil, on 10 September, after reading a fortnight of numbers: "let's stop
-- doing automated outreach to the Facebook ads... my whole idea now is to stop
-- just doing automated outreach because it doesn't seem to be working. I need
-- a call with these people."
--
-- The evidence behind that: fifteen leads were auto-texted and two replied.
-- The three re-texting rounds on top produced no orders at all, and the last
-- one produced a single response which was a STOP. Meanwhile the two web doors
-- reply at fifty percent. Whatever the adverts are buying, a text is not
-- collecting it.
--
-- TWO THINGS, AND THEY ARE SEPARATE.
--
-- 1. app_settings.lead_auto_text turns the automatic message off. The sweep
--    still reads the sheet on the same timer and still records every lead,
--    because that is what fills the screen he is going to work from. What
--    stops is the send. Switching the sweep off entirely would leave the new
--    portal empty, which is the opposite of the ask.
--
--    It lives here rather than in an environment variable for the same reason
--    follow_ups_on does: it is a decision about how the business runs today,
--    it should be reversible without a deploy, and the screen it affects can
--    then say plainly which way it is set.
--
--    DEFAULT FALSE. Every other switch in this table defaults to the old
--    behaviour; this one defaults to the new one, because the migration IS the
--    change being asked for. Turning it back on is a deliberate act.
--
-- 2. lead_outreach records that a person made contact. This is the one thing
--    in the whole system that CANNOT be derived, and that is worth being
--    explicit about because the doctrine everywhere else is the opposite. A
--    text leaves a row in `messages`. A phone call leaves nothing anywhere:
--    no message, no order, no event. If we do not write it down at the moment
--    it happens, the answer to "did anybody ring this person" is gone.
--
--    Same category as orders.reminder_sent_at - a fact about something WE did,
--    with no other home.
--
-- WHY A LOG AND NOT TWO COLUMNS ON facebook_leads. Because you ring somebody,
-- get voicemail, ring again two days later, then text. A pair of columns holds
-- the last of those and silently loses the rest, so the screen could never
-- answer "how many times have we tried this number", which is the question
-- that decides whether to try again. Append only, like order_events, and for
-- the same reason: a record you can tidy up afterwards is not evidence.
--
-- "Have we reached out" is then DERIVED from whether any row exists, which
-- keeps the house rule intact - the fact is stored once, at the only moment it
-- is knowable, and every screen reads the same answer off it.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists lead_auto_text boolean not null default false;

comment on column app_settings.lead_auto_text is
  'False stops the Facebook lead sweep texting anybody. The sweep still reads '
  'the sheet and records every lead - only the automatic message stops. Neil''s '
  'call on 10 Sep 2026: the adverts are worth working by phone, not by text.';

-- ---------------------------------------------------------------------------
-- One row per attempt to reach a lead.
-- ---------------------------------------------------------------------------
create table if not exists lead_outreach (
  id         uuid primary key default gen_random_uuid(),

  -- Meta's lead id. Cascades, because an attempt to reach a lead that no
  -- longer exists is not a record of anything.
  lead_id    text not null references facebook_leads (lead_id) on delete cascade,

  -- WHAT WAS ACTUALLY DONE, not how it went. Neil asked for call or text; the
  -- other two are the outcomes of a call that mean "I tried and did not speak
  -- to them", and they earn their place by being the difference between a
  -- number to leave alone and a number to ring again tomorrow. Without them a
  -- no-answer gets marked as reached out and nobody ever calls back.
  method     text not null check (method in ('CALL', 'VOICEMAIL', 'NO_ANSWER', 'TEXT')),

  -- Who did it. Kept even if they later leave, like every other record of who
  -- did what, which is why this is set null rather than cascade.
  by_user_id uuid references ops_users (id) on delete set null,

  -- Optional. "Asked me to try after 6" is the sort of thing that decides the
  -- next attempt and belongs nowhere else.
  note       text,

  at         timestamptz not null default now()
);

-- The screen asks "what has happened to this lead" one lead at a time, newest
-- attempt first.
create index if not exists lead_outreach_lead_idx
  on lead_outreach (lead_id, at desc);

alter table lead_outreach enable row level security;

comment on table lead_outreach is
  'Append only. One row per attempt to reach a Facebook lead by a person. A '
  'phone call leaves no other trace in this system, which is why this is '
  'stored rather than derived - see the note in 0082.';
