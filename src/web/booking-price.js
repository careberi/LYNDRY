'use strict';
const { escapeHtml } = require('./quote-result');
const money = cents => '$' + (cents / 100).toFixed(2);
function planEstimate(p) {
  return `<dl class="booking-plan-estimate">
    <div><dt>Estimated laundry rate</dt><dd>${money(p.rateCentsPerLb)}/lb</dd></div>
    <div><dt>Operational fee · per order</dt><dd>${money(p.operationalFeeCents)}</dd></div>
    <div><dt>Minimum · includes fee</dt><dd>${money(p.minimumTotalCents)}</dd></div>
    <div><dt>Estimated total · 30–40 lb</dt><dd>${money(p.estimated30LbCents)}–${money(p.estimated40LbCents)}</dd></div>
  </dl>`;
}
function review(quote, carriedFields) {
  const p = quote.snapshot;
  const pickupLabel = quote.pickup_date && quote.pickup_time
    ? new Date(quote.pickup_date+'T'+String(quote.pickup_time).slice(0,5)+':00Z').toLocaleString('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'})
    : '';
  return `<section class="container booking-review">
    <header class="booking-review-heading"><p class="eyebrow">Your pickup · price review</p>
      <h1>Review your pickup.</h1>
      <p>Wash, dry &amp; fold, with pickup and return. Up to <strong>50 lb per order.</strong></p>
      ${pickupLabel ? `<p><strong>Pickup: ${escapeHtml(pickupLabel)} (Eastern)</strong></p>` : ''}
    </header>
    <div class="booking-review-layout">
      <section class="card card-xl booking-price-summary" aria-labelledby="price-summary-title">
        <p class="eyebrow">${p.category === 'SUBSCRIPTION' ? 'Subscription pickup' : p.category === 'WHOLESALE' ? 'Wholesale pickup' : 'One-time pickup'} · Your estimate</p><h2 id="price-summary-title">${money(p.rateCentsPerLb)}/lb</h2>
        <p>Wash, dry &amp; fold</p>
        <dl class="booking-price-lines">
          <div><dt>Operational fee<span>Once per order</span></dt><dd>${money(p.operationalFeeCents)}</dd></div>
        </dl>
      </section>
      <section class="card card-xl booking-order-totals" aria-labelledby="order-totals-title">
        <h2 id="order-totals-title">Order totals</h2>
        <p>These totals include your laundry and operational fee. They are not additional charges.</p>
        <dl class="booking-price-lines">
          <div><dt>Estimated total · 30–40 lb<span>Includes the operational fee</span></dt><dd>${money(p.estimated30LbCents)}–${money(p.estimated40LbCents)}</dd></div>
          <div><dt>Minimum charge<span>Includes the operational fee</span></dt><dd>${money(p.minimumTotalCents)}</dd></div>
        </dl>
        <p class="field-hint">Final weight determines your bill using the order’s per-pound rate, operational fee and minimum.</p>
        <form method="post" action="/account/book" id="wizard">
          ${carriedFields}
          <input type="hidden" name="step" value="quote"><input type="hidden" name="dev_quote_id" value="${escapeHtml(quote.id)}">
          <p class="field-hint">By continuing, you confirm the per-pound rate, operational fee and minimum charge shown above.</p>
          <button class="btn btn-primary btn-lg btn-full" type="submit" name="price_consent" value="yes">Confirm price and continue {{ICON_ARROW}}</button>
          <button class="btn btn-full" name="back" value="when" formnovalidate>Change pickup</button>
        </form>
      </section>
    </div>
    <p class="booking-development-note">Development preview · Courier costs are simulated. No real driver will be requested.</p>
  </section>`;
}
module.exports = {planEstimate,review};
