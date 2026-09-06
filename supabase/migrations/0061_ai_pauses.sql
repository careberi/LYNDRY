-- ---------------------------------------------------------------------------
-- 0061 — a person takes a conversation over.
--
-- THE PROBLEM. There was already one way the AI stops talking: it raises an
-- issue with ai_hold set, goes silent, and picks the thread back up by itself
-- once a person has replied AND the customer has answered. That is the right
-- behaviour for the AI giving up, and it is the wrong behaviour for a person
-- deciding to handle somebody themselves - because the customer's next message
-- turns it straight back on, in the middle of the conversation the person was
-- having.
--
-- So this is a SWITCH, not a hold. A person turns it off, a person turns it
-- back on, and nothing the customer does moves it either way. The two exist
-- side by side and mean different things:
--
--   the hold   the AI ran out of road and is waiting to be rescued
--   the pause  somebody has this one, hands off
--
-- KEYED ON THE NUMBER, like dismissed_leads and for the same reason: the
-- conversations screen is a list of phone numbers, and some of them have no
-- customer row at all. Keying on a customer would silently lose the pause the
-- moment a number that was never a customer became one.
--
-- ONE ROW PER NUMBER, holding the current state rather than a history. Who
-- paused it and who let it go are both kept, because "why has nobody replied
-- to this person" is a question somebody asks a week later.
-- ---------------------------------------------------------------------------

create table if not exists ai_pauses (
  -- E.164, the same normalised form the messages table stores.
  phone       text primary key,

  -- The switch itself. Resuming leaves the row behind rather than deleting it,
  -- so the page can still say who took it over and when.
  paused      boolean not null default true,

  paused_at   timestamptz not null default now(),

  -- Who. Null if it was done with the machine key, which has no person
  -- attached - exactly like issues.resolved_by and dismissed_leads.
  paused_by   uuid references ops_users(id) on delete set null,

  resumed_at  timestamptz,
  resumed_by  uuid references ops_users(id) on delete set null,

  -- Optional. "Complaint about a stain, calling them" is worth more than a
  -- timestamp on its own to whoever opens the thread next.
  note        text
);

-- Only the paused ones are ever looked up in bulk - the conversations list asks
-- "which of these numbers is muted", never "show me every number ever paused".
create index if not exists ai_pauses_paused_idx on ai_pauses (phone) where paused;

-- Same rule as every other table: RLS on, no policies, so the public anon key
-- can reach nothing. The server uses the service_role key, which bypasses it.
alter table ai_pauses enable row level security;

comment on table ai_pauses is
  'Conversations a person has taken over from the AI. One row per phone '
  'number. Deliberately NOT the same thing as issues.ai_hold: a hold is the AI '
  'giving up and lifts itself when the conversation resumes, this is a person '
  'switching it off and only a person switches it back on.';
