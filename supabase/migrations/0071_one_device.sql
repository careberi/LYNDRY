-- ---------------------------------------------------------------------------
-- 0071 — one signed-in device per person.
--
-- Neil's ask. Signing in on a phone left the laptop signed in too, and every
-- device he had ever opened the ops screens on stayed live. For a tool holding
-- customer addresses, phone numbers and the books, that is a lot of doors.
--
-- WHY A COLUMN IS NEEDED AT ALL. The session cookie is deliberately stateless -
-- `userId.expiry.signature`, signed with ADMIN_API_KEY, with nothing stored
-- server-side. That is what makes it cheap and what makes ROTATING
-- ADMIN_API_KEY sign everybody out instantly. But it also means there is
-- nothing to revoke: every cookie ever minted for a user is equally valid until
-- it lapses on its own.
--
-- So the cookie now carries a token as well, and the token lives here. Signing
-- in mints a new one; every cookie holding the old one stops validating on its
-- next request. One row, one live session, no session table to grow or sweep.
--
-- NULL MEANS EVERY EXISTING SESSION IS DEAD, which is the correct migration:
-- a cookie minted before this column existed has no token in it, cannot match,
-- and its holder signs in again. Nobody is left holding a session that predates
-- the rule the column exists to enforce.
-- ---------------------------------------------------------------------------

alter table ops_users
  add column if not exists session_token text;

alter table ops_users
  add column if not exists session_started_at timestamptz;

comment on column ops_users.session_token is
  'The one session this person may be signed in with. Minted on every '
  'successful code entry and carried inside the cookie, so signing in anywhere '
  'else stops every other device on its next request. Null means no live '
  'session - which is also what every cookie minted before this column looked '
  'like, so adding it signed everybody out exactly once.';
