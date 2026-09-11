-- ---------------------------------------------------------------------------
-- 0085 — which Google ad click a customer came from
-- ---------------------------------------------------------------------------
--
-- Neil, 10 September, with two Google Search campaigns live: capture the Google
-- click id and keep it on the customer, "so we can upload booked first pickups
-- back to Google later, so the ads can learn which clicks become paying
-- customers, not just leads."
--
-- WHY THIS IS STORED. The website form tells Google that somebody became a
-- lead, the moment it happens. It cannot tell Google that the same person paid
-- for a pickup a week later, because by then they are texting us, not browsing
-- the site. The click id is the only thing that joins a paying customer back to
-- the ad click that found them, and Google only accepts an offline conversion
-- that names one. Without the column there is nothing to upload.
--
-- THREE BECAUSE GOOGLE ISSUES THREE. gclid is the ordinary one. gbraid and
-- wbraid are what Google sends instead on Apple devices where tracking is
-- restricted (app-to-web and web-to-web respectively). A click carries one of
-- them, and an upload has to use whichever it was.
--
-- NOT A PHONE NUMBER AND NOT A NAME. These are Google's own opaque identifiers
-- for an ad click. They identify a click, not a person, and nothing about the
-- customer is sent anywhere by storing them.
--
-- FIRST TOUCH. Written once, when a customer is created from a website form,
-- and never overwritten - the click worth crediting is the one that brought
-- them in. Null for every customer who did not arrive from a Google ad, which is
-- most of them, and for everybody created before this existed.
-- ---------------------------------------------------------------------------

alter table customers
  add column if not exists gclid text,
  add column if not exists gbraid text,
  add column if not exists wbraid text;

comment on column customers.gclid is
  'Google ad click id from the landing URL, kept for 90 days in a first-party '
  'cookie and written when a website form creates the customer. For uploading '
  'offline conversions. First touch; never overwritten.';
comment on column customers.gbraid is
  'Google click id issued instead of gclid for app-to-web clicks on restricted '
  'iOS traffic. See gclid.';
comment on column customers.wbraid is
  'Google click id issued instead of gclid for web-to-web clicks on restricted '
  'iOS traffic. See gclid.';
