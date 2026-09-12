-- ---------------------------------------------------------------------------
-- 0089 — the offer popup on the website
-- ---------------------------------------------------------------------------
--
-- Neil, 12 September: a popup on lyndry.com offering 50% off a first order,
-- switched on and off from the ops screens, tied to the promotion itself.
--
-- ONE BOOLEAN, AND NO PROMOTION ID BESIDE IT. That is the whole point of this
-- column and it is worth writing down, because storing "which promotion the
-- popup advertises" is the obvious design and it is wrong.
--
-- A popup that names an offer is a promise made to a stranger before they have
-- typed anything. The only promotion we can actually keep that promise with is
-- the one a brand new number is given automatically - promotions.autoGrant(),
-- the single ACTIVE row whose audience is NEW_NUMBERS. A stored id would be a
-- second copy of that fact, and it would go stale the first time somebody
-- created another automatic promotion: CLAUDE.md already records that creating
-- a second one stands the first down, so the website would have gone on
-- advertising an offer nobody was being given any more.
--
-- So the switch says only whether the popup shows. What it SAYS is read off
-- the live automatic promotion every time, and a promotion with no blurb is
-- silent on the website exactly as it is silent to the AI.
--
-- Defaults to false: a column arriving in a deploy must not switch a popup on
-- for every visitor the moment it lands.
-- ---------------------------------------------------------------------------

alter table app_settings
  add column if not exists website_popup boolean not null default false;

comment on column app_settings.website_popup is
  'Does lyndry.com show the offer popup. What it says comes from '
  'promotions.autoGrant() - the promotion every new number is given - so the '
  'website can never advertise an offer the code is not handing out. See '
  'src/core/site-popup.js.';
