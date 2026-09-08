-- ---------------------------------------------------------------------------
-- 0077 — who was paged about an issue, and whether they were paged twice.
--
-- When the AI hands a customer to a manager it texts every active admin with a
-- phone number. On 5 September it created the issue row and the text went to
-- nobody: there was no team member with a phone yet and SUPPORT_PHONE was
-- unset. The only trace was a block of console.error in a deploy log, the
-- customer was told "they'll come back to you shortly", and the issue was
-- later marked resolved without her ever hearing from anyone.
--
-- "We told three people" and "we told nobody" were indistinguishable from the
-- row. Now they are not:
--
--   paged_at    when the first alert actually went to somebody. NULL on an open
--               issue means nobody was told, and the Issues screen says so in
--               red rather than leaving it to a log.
--   paged_to    the numbers it went to. Evidence, the same way sms_consent_ip is.
--   repaged_at  the scheduler asks every tick whether an open issue older than
--               fifteen minutes has had a person write to the customer, and if
--               not it pages everybody once more. Once, because a pager that
--               keeps going gets muted. This is that stamp.
--
-- Nothing here changes what an issue IS. It stays OPEN until a person closes
-- it, exactly as 0018 said; these only record whether that person was ever
-- asked to.
-- ---------------------------------------------------------------------------

alter table issues
  add column if not exists paged_at   timestamptz,
  add column if not exists paged_to   text[],
  add column if not exists repaged_at timestamptz;

-- Every issue raised before this column existed was either paged or not, and
-- there is no way to tell which from here. Left NULL rather than backfilled
-- with a guess: a made-up paging record is worse than an absent one, and the
-- open ones will be re-paged by the scheduler on its next tick, which is the
-- correct thing to happen to an open issue nobody has answered.

comment on column issues.paged_at is
  'When the alert about this issue first reached a person. NULL on an open '
  'issue means nobody was told - no active admin with a phone, no SUPPORT_PHONE.';

comment on column issues.paged_to is
  'The phone numbers the alert went to. Evidence of who knew.';

comment on column issues.repaged_at is
  'When everybody was told a second time because no person had written to the '
  'customer within fifteen minutes. Stamped once; nothing pages a third time.';
