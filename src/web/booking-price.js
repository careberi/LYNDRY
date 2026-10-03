'use strict';
const feeBreakdown = require('./quote-fee-breakdown');
const feeRows = p => feeBreakdown(p).map(([label, cents]) => `<div><dt>${label}</dt><dd>${money(cents)}</dd></div>`).join('');
const { escapeHtml } = require('./quote-result');
const money = cents => '$' + (cents / 100).toFixed(2);
function planEstimate(p) {
  if(require('../core/weight-based-pricing').isSnapshot(p)) return require('./weight-pricing').estimate(p);
  return `<div class="booking-plan-estimate"><dl>
    <div><dt>Wash, dry &amp; fold</dt><dd>${money(p.rateCentsPerLb)}/lb</dd></div>
    ${feeRows(p)}
  </dl><p class="booking-minimum">Minimum total: ${money(p.minimumTotalCents)}</p></div>`;
}
function review(quote, carriedFields) {
  const p = quote.snapshot;
  if(require('../core/weight-based-pricing').isSnapshot(p)) return weightReview(quote,carriedFields);
  const pickupLabel = quote.pickup_date && quote.pickup_time
    ? new Date(quote.pickup_date+'T'+String(quote.pickup_time).slice(0,5)+':00Z').toLocaleString('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'})
    : '';
  return `<section class="container booking-review">
    ${require("./booking-progress").render("review")}
    <header class="booking-review-heading"><p class="eyebrow">Your pickup · price review</p>
      <h1>Review your pricing method.</h1>
      <p>Wash, dry &amp; fold, with pickup and return. Up to <strong>50 lb per order.</strong></p>
      ${pickupLabel ? `<p><strong>Pickup: ${escapeHtml(pickupLabel)} (Eastern)</strong></p>` : ''}
    </header>
    <div class="booking-review-layout">
      <section class="card card-xl booking-price-summary" aria-labelledby="price-summary-title">
        <p class="eyebrow">${p.category === 'SUBSCRIPTION' ? 'Subscription pickup' : p.category === 'WHOLESALE' ? 'Wholesale pickup' : 'One-time pickup'} · Your pricing</p><h2 id="price-summary-title">${money(p.rateCentsPerLb)}/lb</h2>
        <p>Wash, dry &amp; fold</p>
        <dl class="booking-price-lines">
          ${feeRows(p)}
        </dl>
        <p class="booking-minimum">Minimum total: ${money(p.minimumTotalCents)}</p>
      </section>
      <section class="card card-xl booking-order-totals" aria-labelledby="order-totals-title">
        <h2 id="order-totals-title">Your final bill</h2>
        <p>Delivery, operational and service fees apply once per order. No additional processing charge.</p>
        <p class="field-hint">Final weight determines your bill using the order’s per-pound rate, fees and minimum.</p>
        ${p.policy?.cardHold ? `<p><strong>Temporary card hold: ${money(require('../core/card-hold-policy').amount(p))}.</strong> This is held, not charged, and is applied toward your final bill. Any unused hold is released.</p>` : ''}
        <form method="post" action="/account/book" id="wizard">
          ${carriedFields}
          <input type="hidden" name="step" value="quote"><input type="hidden" name="dev_quote_id" value="${escapeHtml(quote.id)}">
          <p class="field-hint">By continuing, you confirm the per-pound rate, fees and minimum charge${p.policy?.cardHold ? ', and authorize the temporary card hold' : ''} shown above.</p>
          <button class="btn btn-primary btn-lg btn-full" type="submit" name="price_consent" value="yes">Confirm pricing method and continue {{ICON_ARROW}}</button>
          <button class="btn btn-full" name="back" value="when" formnovalidate>Change pickup</button>
        </form>
      </section>
    </div>
    <p class="booking-development-note">Development preview · Courier costs are simulated. No real driver will be requested.</p>
  </section>`;
}
function pickupTiming(p) {
 if(!p?.pickupReadyAt)return '';
 const label=at=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(at));
 return `<p class="field-hint">Have your bag ready ${escapeHtml(label(p.pickupReadyAt))} (Eastern).${p.pickupEstimateAt?` Estimated courier pickup: ${escapeHtml(label(p.pickupEstimateAt))} (Eastern). Arrival may change with driver availability.`:''}</p>`;
}
module.exports = {planEstimate,review,pickupTiming};

function weightReview(quote,carriedFields) {
 const p=quote.snapshot,model=require('../core/weight-based-pricing');
 const price=model.total(p,p.estimatedWeightLb),maximum=model.total(p,50);
 return `<section class="container booking-review">${require('./booking-progress').render('review')}
 <header class="booking-review-heading"><h1>Review your pricing method.</h1>${pickupTiming(p)||`<p>${escapeHtml(quote.pickup_date)} at ${escapeHtml(String(quote.pickup_time).slice(0,5))} (Eastern)</p>`}</header>
 <div class="card card-xl booking-price-summary"><h2>${p.category==='SUBSCRIPTION'?'Subscription':p.category==='WHOLESALE'?'Wholesale':'One-time pickup'}</h2>
 ${require('./weight-pricing').estimate({...p,weightTotalsCents:null})}
 <p>Your estimate is <strong>${money(price)} for ${p.estimatedWeightLb} lb</strong>. We recalculate your total from the measured weight after pickup. Below the included weight, the displayed rate is based on the full minimum allowance; above it, the rate is the average at your selected weight. It is not a fixed per-pound rate for larger bags.</p>
 <p>Your saved pricing method covers wash, dry &amp; fold, pickup, return and processing. Total range: ${money(model.total(p,1))} at 1 lb to ${money(maximum)} at 50 lb. The ${money(p.minimumTotalCents)} minimum is included.</p>
 ${p.policy?.cardHold?`<p>Temporary card hold: <strong>${money(require('../core/card-hold-policy').amount(p))}</strong>. This is held, not charged, and applied toward your final bill. Any unused hold is released.</p>`:''}
 <form method="post" action="/account/book" id="wizard">${carriedFields}<input type="hidden" name="step" value="quote"><input type="hidden" name="dev_quote_id" value="${escapeHtml(quote.id)}">
 <p class="field-hint">By continuing, you agree to billing at measured weight using the saved pricing schedule, the minimum and the temporary card hold shown above.</p>
 <button class="btn btn-primary btn-lg btn-full" type="submit" name="price_consent" value="yes">Confirm pricing method and continue {{ICON_ARROW}}</button>
 <button class="btn btn-full" name="back" value="repeat" formnovalidate>Change tier or estimated weight</button></form></div></section>`;
}
