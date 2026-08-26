-- ---------------------------------------------------------------------------
-- 0041 — the pre-launch waitlist behind /bergen.
--
-- A paid-ads landing page collects a number, an address and a ZIP before the
-- service opens. It is deliberately NOT the customers table:
--
--   A customer is somebody we have a relationship with - consent, preferences,
--   orders, a card. A waitlist row is a stranger who saw an advert and typed
--   three fields. Merging them would mean every board, every count and every
--   "how many customers do we have" answer silently included people who have
--   never spoken to us.
--
-- They become customers when they text, through the normal onboarding path,
-- and that is where the promotion is granted. Nothing here creates one.
--
-- NO TEXT IS SENT ON SUBMIT. The 10DLC campaign for this is not live, and
-- texting somebody the moment they fill in an advert form is exactly the
-- traffic that gets a number blocked. The row is the record; the outreach
-- happens later and deliberately.
-- ---------------------------------------------------------------------------

create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),

  -- Stored E.164, normalised before it ever reaches here, so the unique index
  -- actually catches a duplicate. "(201) 555-1234" and "2015551234" are the
  -- same person and must not be two rows.
  phone_e164 text not null,

  -- Nullable: the advert form asks for a number and nothing else. One field
  -- converts better on cold mobile traffic, and an address is something we can
  -- ask for in the thread. Kept as columns for whenever we do.
  street_address text,
  zip            text,

  -- WHEN THEY TICKED THE BOX, kept as its own column rather than leaning on
  -- created_at. They are the same instant today, and the day somebody imports
  -- a list or backfills a row they stop being - and consent is the one
  -- timestamp an audit actually asks about.
  consent_at timestamptz not null default now(),

  -- Which page or campaign put them here. `source` is ours; the utm_* fields
  -- are whatever the advert appended, kept verbatim so a campaign can be
  -- measured without guessing.
  source       text not null default 'bergen',
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text,

  -- Evidence, the same pair the signup form already records.
  ip         text,
  user_agent text,

  created_at timestamptz not null default now()
);

-- One row per number. A second submit is the same person pressing the button
-- twice or coming back through a different advert, and it must be a success
-- rather than an error - a stranger who sees a failure message assumes we lost
-- them and does not try again.
create unique index if not exists waitlist_phone_key on waitlist (phone_e164);

create index if not exists waitlist_created_idx on waitlist (created_at desc);

alter table waitlist enable row level security;

comment on table waitlist is
  'Pre-launch signups from the /bergen advert page. NOT customers: nobody here '
  'has texted us, given preferences or saved a card. They become a customer '
  'through onboarding when they first text.';

comment on column waitlist.phone_e164 is
  'Normalised to +1XXXXXXXXXX before insert, so the unique index genuinely '
  'catches the same person typing their number a different way.';
