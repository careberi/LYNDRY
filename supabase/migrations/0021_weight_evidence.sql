-- Evidence for the number that charges somebody's card.
--
-- The weight is the price. It is entered by one person, on one scale, with
-- nothing behind it, and it is what moves money. Two things go on the order to
-- make that number answerable afterwards.
--
-- 1. A PHOTO OF THE SCALE DISPLAY, taken when the weight is entered.
--
--    Ten seconds of a driver's time, and it settles every argument in both
--    directions: the customer who is certain their bag was not 40 lb, and the
--    laundromat whose own invoice says 44. Without it the only record of a
--    four-figure charge is somebody's memory.
--
-- 2. THE LAUNDROMAT'S OWN FIGURE, as a cross-check and nothing more.
--
--    Neil's call, and the right one. Our driver's weight still bills - that
--    control does not move, because a partner's scale reading 400 instead of 40
--    would be a $1,000 charge on a customer's card with nobody of ours between
--    the two. But a laundromat weighs the bag anyway for its own invoice, so
--    recording their number costs nothing and catches a bad scale on either
--    side. When the two disagree by more than a little, somebody is told.
--
--    partner_weight_lb is NEVER read by the pricing code. If you find yourself
--    wiring it into price_cents, that is the control being removed.

alter table orders
  add column if not exists weight_photo_path  text,
  add column if not exists partner_weight_lb  numeric(6,2),
  add column if not exists partner_weight_at  timestamptz;

-- Same shape as the weight we bill from, so a nonsense figure is refused by
-- the database rather than only by the form.
alter table orders
  drop constraint if exists orders_partner_weight_check;

alter table orders
  add constraint orders_partner_weight_check
  check (partner_weight_lb is null or (partner_weight_lb > 0 and partner_weight_lb <= 200));

comment on column orders.weight_photo_path is
  'Private storage path of the photo of the scale display, taken when the '
  'weight was entered. The evidence behind the charge.';
comment on column orders.partner_weight_lb is
  'What the laundromat said it weighed. A cross-check only - never used to '
  'price anything. Ours bills.';
comment on column orders.partner_weight_at is
  'When the laundromat entered their figure, through the QR page on the bag.';

-- A private bucket for the scale photos, separate from the delivery photos.
--
-- Different things with different lives: a delivery photo is shown to the
-- customer on a link that expires after 30 days, and a scale photo is internal
-- evidence nobody outside the business ever sees. Keeping them apart means the
-- rules for one can change without touching the other.
insert into storage.buckets (id, name, public)
values ('weight-photos', 'weight-photos', false)
on conflict (id) do nothing;
