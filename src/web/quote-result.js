'use strict';
const feeBreakdown = require('./quote-fee-breakdown');

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
  <div class="${tone} card-xl" style="padding:26px 28px;max-width:52ch;margin-inline:auto;">${inner}<p style="margin:18px 0 0;"><a href="/pricing">Change address or try again</a></p></div>
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

function serviceArea({ address, fields = {}, interest = '' }) {
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${escapeHtml(value || '')}">`;
  const message = interest === 'thanks'
    ? `<div class="notice notice-success" role="status" style="margin:20px 0 0;">
         Thanks. We saved your number and will text you when LYNDRY is available in your area.
       </div>`
    : `<form method="post" action="/quote/interest" class="stack" style="margin-top:22px;">
         ${hidden('address', address)}
         ${hidden('street', fields.street)}
         ${hidden('unit', fields.unit)}
         ${hidden('town', fields.town)}
         ${hidden('zip', fields.zip)}
         <div class="field">
           <label class="field-label" for="area-phone">Mobile number</label>
           <input class="input" id="area-phone" name="phone" type="tel" inputmode="tel"
                  autocomplete="tel" placeholder="201-555-0142" required>
         </div>
         <div style="position:absolute;left:-9999px;" aria-hidden="true">
           <label for="area-website">Website</label>
           <input id="area-website" name="website" tabindex="-1" autocomplete="off">
         </div>
         <label style="display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.45;">
           <input type="checkbox" name="sms_consent" value="yes" required style="margin-top:3px;">
           <span>I agree to receive text messages from LYNDRY about service availability.
             Message frequency varies. Message and data rates may apply. Reply STOP to end.</span>
         </label>
         ${interest === 'phone' ? '<p role="alert">Enter a valid US mobile number.</p>' : ''}
         ${interest === 'consent' ? '<p role="alert">Tick the box so we are allowed to text you.</p>' : ''}
         <button class="btn btn-primary btn-full" type="submit">Text me when you reach my area</button>
       </form>`;

  return shell(
    `<p class="eyebrow" style="margin:0 0 10px;">Not in your area yet</p>
     <h2 style="font-family:var(--font-display);font-weight:900;font-size:28px;margin:0 0 14px;">
       Unfortunately, we are not operating in your area at this time.</h2>
     <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0;">
       Leave your mobile number and we will text you when LYNDRY is up and running near you.</p>
     ${message}`
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

  return `<section class="container" style="padding-bottom:72px;">
  <div class="quote-column quote-pricing">
    <p class="eyebrow" style="margin:0 0 10px;">Wash, dry &amp; fold</p>
    <h2 class="display-3" style="margin:0 0 12px;">${perLb(one.perLbCents)} per pound</h2>
    <p class="quote-address">${escapeHtml(address)}</p>
    <div class="card card-xl" style="padding:10px 26px;margin:24px 0;">
      ${row('One-time pickup', `${perLb(one.perLbCents)}/lb`, 'Book when you need us')}
      ${row('Subscription pickup', `${perLb(sub.perLbCents)}/lb`, 'Regular pickups')}
      ${row('Pickup and delivery', money(quote.deliveryFeeCents), quote.quoted ? 'Round trip' : 'Estimated round trip')}
    </div>
    <p class="quote-address">These are laundry rates. Pickup and delivery are charged separately.</p>
    <a href="/account/login?next=%2Faccount%2Fbook" class="btn btn-primary btn-lg btn-full quote-order-button">Book a pickup</a>
    <a href="/pricing" class="quote-change-address">Change address</a>
  </div>
</section>`;

}

// ONE DOOR, so a caller cannot render a price for a refusal or the other way
// round. Everything that decides the answer has already happened.
function render({ quote, address, error, fields, interest }) {
  if (error === 'not_found') return notFound(address);
  if (error === 'unavailable_area') return serviceArea({ address, fields, interest });
  if (error) return unavailable();
  if (!quote) return '';

  if (!quote.ok) {
    // OUR OWN ESTIMATE PUT THEM PAST THE LAST BAND, reached only when no courier
    // could be asked - so the mileage is ours and the wording is about our round.
    if (quote.reason === 'too_far') return serviceArea({ address, fields, interest });

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

  return quote.dynamic ? dynamicPriced(quote,address) : priced(quote, address);
}

module.exports = { render, escapeHtml };

function dynamicPriced(quote,address) {
  if(require('../core/weight-based-pricing').isSnapshot(quote.categories.ONE_TIME)) return require('./weight-pricing').publicQuote(quote,address);
  const one=quote.categories.ONE_TIME;
  const subscription=quote.categories.SUBSCRIPTION;
  const plan=(name,p)=>`<div class="card card-xl quote-plan"><h3>${name}</h3><dl>
    <div><dt>Wash, dry &amp; fold</dt><dd>${money(p.rateCentsPerLb)}/lb</dd></div>
    ${feeBreakdown(p).map(([label, cents]) => `<div><dt>${label}</dt><dd>${money(cents)}</dd></div>`).join('')}
    </dl><p class="quote-minimum">Minimum total: ${money(p.minimumTotalCents)}</p></div>`;
  return `<section class="container" style="padding-bottom:72px;"><div class="quote-column quote-pricing">
    <p class="eyebrow quote-eyebrow">Subscription wash, dry &amp; fold</p>
    <h2 class="display-3 quote-rate-heading">${money(subscription.rateCentsPerLb)} per pound</h2>
    <p class="quote-address">${escapeHtml(address)}</p>
    ${quote.indicative ? '<p class="quote-address">Pricing for your address. Pickup date and time may change availability and pricing.</p>' : ''}
    ${plan('Subscription pickup',subscription)}${plan('One-time pickup',one)}
    <p class="quote-address">${one.pricingMethod === 'COST_PLUS_MARGIN_15' ? 'Delivery, operational and service fees apply once per order. Payment processing is included; there is no additional processing charge.' : 'No separate pickup or delivery charge. The operational fee is included in the minimum total.'}</p>
    <p class="quote-address">Final weight determines your bill. Review and confirm your price when booking. Each subscription pickup receives its own quote.</p>
    <p class="quote-address">Pickup and return availability has been checked. Availability is checked again when you book. No driver is requested and no payment is collected here.</p>
    <a href="/account/login?next=%2Faccount%2Fbook" class="btn btn-primary btn-lg btn-full quote-order-button">Book a pickup</a>
    <a href="/pricing" class="quote-change-address">Change address</a>
  </div></section>`;
}
