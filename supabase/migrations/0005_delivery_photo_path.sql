-- Serve delivery photos from lyndry.com rather than linking to storage.
--
-- Two reasons, both real:
--
--   1. Carriers scrutinise links to domains that are not yours. A message
--      containing a supabase.co link is a rejection risk during business
--      messaging registration; a link on lyndry.com is what reviewers expect.
--
--   2. A signed storage link is enormous and expires. It pushed the delivery
--      text to about four SMS segments, and the photo became unreachable the
--      day the signature ran out.
--
-- So we keep the storage path and sign it fresh whenever someone opens the
-- link, instead of texting a signature with a deadline on it.

alter table orders
  add column if not exists delivery_photo_path text;

comment on column orders.delivery_photo_path is
  'Where the photo lives in storage. The link we text points at lyndry.com and is signed from this on demand, so it never goes stale.';
comment on column orders.delivery_photo_url is
  'The lyndry.com link the customer was sent.';
