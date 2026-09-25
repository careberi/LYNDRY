'use strict';

// ---------------------------------------------------------------------------
// THE ANSWER BLOCK ON /quote.
//
// Drawn here rather than in the page file because every figure in it is worked
// out at request time - the distance, the band, the laundromat and therefore
// the rate. A page file holds copy and holes; this is the hole being filled.
//
// IT NAMES NO LAUNDROMAT. A customer does not need to know whose machines their
// laundry goes in, and saying it would publish a commercial relationship and a
// rate that are nobody else's business. Same rule the bag page already keeps.
// ---------------------------------------------------------------------------

const { config } = require('../config');
const { site } = require('./site');

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const perLb = (cents) => `$${(cents / 100).toFixed(2)}`;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shell(inner, tone = 'card') {
  return `<section class="container" style="padding-bottom:48px;">
  <div class="${tone} card-xl" style="padding:26px 28px;max-width:52ch;">${inner}</div>
</section>`;
}

// --- the refusals -----------------------------------------------------------
//
// EACH ONE SAYS WHAT TO DO NEXT. "We cannot serve you" with no next step is the
// end of the conversation; naming the reason lets somebody a mile outside ask
// whether that changes, which it does every time a laundromat is added.

function tooFar({ miles, maxMiles }) {
  return shell(
    `<p class="eyebrow" style="margin:0 0 10px;">Not yet</p>
     <h2 style="font-family:var(--font-display);font-weight:900;font-size:28px;margin:0 0 14px;">
       You are outside the round.</h2>
     <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0 0 12px;">
       Your address is about ${escapeHtml(miles.toFixed(1))} miles from our nearest laundromat, and we
       work within ${escapeHtml(String(maxMiles))} miles of one.</p>
     <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0;">
       That changes as we add laundromats. Text us on
       <strong>${escapeHtml(site.publicPhoneDisplay)}</strong> and we will let you know when we reach you.</p>`
  );
}

function notFound(address) {
  return shell(
    `<p class="eyebrow" style="margin:0 0 10px;">Try again</p>
     <h2 style="font-family:var(--font-display);font-weight:900;font-size:28px;margin:0 0 14px;">
       We could not find that address.</h2>
     <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0;">
       We looked for &ldquo;${escapeHtml(address)}&rdquo;. A street number, street and town usually does
       it, like &ldquo;16 Chandler Dr, Fair Lawn NJ&rdquo;. Or text us on
       <strong>${escapeHtml(site.publicPhoneDisplay)}</strong> and we will work it out with you.</p>`
  );
}

function unavailable() {
  return shell(
    `<p class="eyebrow" style="margin:0 0 10px;">One moment</p>
     <h2 style="font-family:var(--font-display);font-weight:900;font-size:28px;margin:0 0 14px;">
       We could not work that out just now.</h2>
     <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0;">
       Try again in a minute, or text us on <strong>${escapeHtml(site.publicPhoneDisplay)}</strong> and
       we will tell you the price ourselves.</p>`
  );
}

// THE COURIER WOULD NOT TAKE THE TRIP, and the honest part is that we do not
// know which of two reasons it is.
//
// Uber answers `address_undeliverable` both for an address outside the area they
// drive and for one that resolved to the wrong street of that name - measured on
// 25 September, where 350 Engle St in Englewood priced fine and 100 Grand Ave in
// the same town did not. So this says both possibilities and asks them to check,
// which is true either way.
//
// IT MUST NOT SAY "WE DO NOT COVER YOU". That would be a flat statement to a
// Bergen County customer on the strength of an ambiguous code, and the one case
// where it is wrong is somebody we could serve today deciding we cannot.
// AND IT MUST NOT SAY "TRY AGAIN IN A MINUTE" EITHER, which is what this used to
// fall through to: a minute changes nothing and it sends them round a loop.
function cannotReach(address) {
  return shell(
    `<p class="eyebrow" style="margin:0 0 10px;">Have a look at this</p>
     <h2 style="font-family:var(--font-display);font-weight:900;font-size:28px;margin:0 0 14px;">
       We could not get a courier to that address.</h2>
     <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0 0 12px;">
       We tried &ldquo;${escapeHtml(address)}&rdquo;. Either it is outside the area our couriers
       cover, or the address needs a second look &mdash; a street number and town usually sorts it.</p>
     <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0;">
       Text us on <strong>${escapeHtml(site.publicPhoneDisplay)}</strong> and we will tell you which
       it is.</p>`
  );
}

// --- the price --------------------------------------------------------------

function priced(quote, address) {
  const one = quote.categories.ONE_TIME;
  const sub = quote.categories.SUBSCRIPTION;

  const row = (label, value, note) => `
    <div class="price-row">
      <span style="font-size:16px;color:var(--ink-800);">${label}${
        note ? `<br><span style="font-size:13px;color:var(--ink-500);">${note}</span>` : ''
      }</span>
      <span class="amount">${value}</span>
    </div>`;

  return `<section class="container" style="padding-bottom:56px;">
  <div style="max-width:52ch;" data-reveal>
    <p class="eyebrow" style="margin:0 0 10px;">Your price</p>
    <h2 class="display-3" style="margin:0 0 6px;">${perLb(one.perLbCents)} a pound.</h2>
    <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0 0 20px;">
      Plus ${quote.quoted ? '' : 'about '}${money(quote.deliveryFeeCents)} for the courier, there and
      back, at ${escapeHtml(address)}.${
        quote.quoted
          ? ''
          : ' We could not reach the courier just now, so that part is our estimate.'
      }
    </p>

    <div class="card card-xl" style="padding:10px 26px;margin-bottom:18px;">
      ${row('One-time pickup', `${perLb(one.perLbCents)}/lb`, 'Book whenever you need us')}
      ${row('On a subscription', `${perLb(sub.perLbCents)}/lb`, 'Weekly, fortnightly or monthly')}
      ${row('Pickup and delivery', money(quote.deliveryFeeCents), 'Both journeys, charged once')}
      ${row('Smallest order', money(quote.minimumCents), 'However little you send')}
    </div>

    <div class="card card-xl" style="padding:18px 26px;margin-bottom:18px;background:var(--sunbeam-500);">
      <p style="font:700 12px/1 var(--font-mono);letter-spacing:.07em;text-transform:uppercase;margin:0 0 8px;">
        A full machine, about 20 lb</p>
      <p style="font-size:15px;line-height:1.6;margin:0;">
        <strong style="font-family:var(--font-display);font-size:24px;">${money(one.typical20lbCents)}</strong>
        one-time, or <strong>${money(sub.typical20lbCents)}</strong> on a subscription. Everything in,
        nothing added afterwards.
      </p>
    </div>

    <p style="font-size:14px;line-height:1.6;color:var(--ink-500);margin:0 0 22px;">
      Your laundry is weighed after we collect it and that is when you are charged, so the exact total
      follows the actual weight. Nothing is taken when you book.
    </p>

    <a href="${site.hasPublicPhone ? `sms:${escapeHtml(site.publicPhoneLink)}` : '/#get-started'}"
       class="btn btn-brand" style="width:100%;">
      Text us to book
    </a>
  </div>
</section>`;
}

// ONE DOOR, so a caller cannot render a price for a refusal or the other way
// round. Everything that decides the answer has already happened.
function render({ quote, address, error }) {
  if (error === 'not_found') return notFound(address);
  if (error) return unavailable();
  if (!quote) return '';

  if (!quote.ok) {
    // OUR OWN ESTIMATE PUT THEM PAST THE LAST BAND, reached only when no courier
    // could be asked - so the mileage is ours and the wording is about our round.
    if (quote.reason === 'too_far') return tooFar(quote);

    // THE COURIER COULD NOT PLACE THE ADDRESS AT ALL. Their own code for it, and
    // it is the same problem as our geocoder missing it, so it gets the same
    // page: check what you typed.
    if (quote.reason === 'unknown_location') return notFound(address);

    // THE COURIER PLACED IT AND WILL NOT DRIVE THERE.
    if (quote.reason === 'address_undeliverable') return cannotReach(address);

    // Anything else really is us: no laundromat has a rate, the database is
    // unhappy, a code Uber has not sent before.
    return unavailable();
  }

  return priced(quote, address);
}

module.exports = { render, escapeHtml };
