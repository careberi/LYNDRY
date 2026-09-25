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
      Plus ${money(quote.deliveryFeeCents)} for the courier, there and back, at
      ${escapeHtml(address)}.
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
  if (!quote.ok && quote.reason === 'too_far') return tooFar(quote);
  if (!quote.ok) return unavailable();
  return priced(quote, address);
}

module.exports = { render, escapeHtml };
