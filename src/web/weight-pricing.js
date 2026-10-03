'use strict';
const model = require('../core/weight-based-pricing');
const {escapeHtml: e} = require('./layout');
const money = cents => '$' + (cents / 100).toFixed(2);
const names = {SUBSCRIPTION: 'Subscription', ONE_TIME: 'One-time pickup', WHOLESALE: 'Wholesale'};
function schedule(p) { return p.weightTotalsCents || Array.from({length: 50}, (_, i) => model.total(p, i + 1)); }
// A preliminary slider compares shops at each weight; the confirmed quote
// removes that schedule and shows only the selected shop's saved minimum.
function minimum(p) {
  return p.weightTotalsCents && p.minimumWeightLb != null
    ? p.weightTotalsCents[p.minimumWeightLb-1] : p.minimumTotalCents;
}
function stepIcon(plus) {
  return `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14${plus ? 'M12 5v14' : ''}"/></svg>`;
}
function rangeLabels(categories) {
  if(!categories) return '<div class="weight-range-labels" aria-hidden="true"><span>1 lb</span><span>50 lb</span></div>';
  const tiers=(categories.SUBSCRIPTION||categories.ONE_TIME?['SUBSCRIPTION','ONE_TIME']:['WHOLESALE']).filter(key=>categories[key]);
  const minimumWeight=categories[tiers[0]]?.minimumWeightLb;
  return `<div class="weight-range-labels weight-range-rates" aria-label="Per-pound rates at the ends of the weight range">
    <div><strong>${minimumWeight?`1–${minimumWeight} lb`:'1 lb'}</strong>${tiers.map(key=>{
      const p=categories[key], included=model.minimumIncludedWeight(p);
      return `<p><b>${money(included>0?minimum(p)/included:schedule(p)[0])}/lb</b> <span>${key==='WHOLESALE'?'Wholesale':key==='SUBSCRIPTION'?'Subscription':'One-time'}</span></p>`;
    }).join('')}</div>
    <div><strong>50 lb</strong>${tiers.map(key=>`<p><b>${money(schedule(categories[key])[49]/50)}/lb</b> <span>${key==='WHOLESALE'?'Wholesale':key==='SUBSCRIPTION'?'Subscription':'One-time'}</span></p>`).join('')}</div>
  </div>`;
}
function slider(weight = 30, categories = null) {
  return `<div class="weight-selector">
    <div class="weight-selector-heading">
      <div><label for="bag-weight">Estimate your bag weight</label><p>An estimate is fine. We weigh it after pickup.</p></div>
      <div class="weight-stepper">
        <button type="button" data-weight-adjust="-1" aria-label="Decrease bag weight"${weight<=1?' disabled':''}>${stepIcon(false)}</button>
        <div class="weight-number"><input id="bag-weight" name="estimated_weight_lb" type="number" inputmode="numeric" min="1" max="50" step="1" value="${e(weight)}" required aria-describedby="weight-help weight-error" enterkeyhint="done"><span>lb</span></div>
        <button type="button" data-weight-adjust="1" aria-label="Increase bag weight"${weight>=50?' disabled':''}>${stepIcon(true)}</button>
      </div>
    </div>
    <input class="weight-slider" type="range" min="1" max="50" step="1" value="${e(weight)}" aria-label="Estimated bag weight in pounds" data-weight-slider style="--weight-progress:${(weight-1)/49*100}%">
    ${rangeLabels(categories)}
    <p id="weight-error" role="alert" hidden>Enter a whole number from 1 to 50 lb.</p>
    <p class="sr-only" data-weight-status role="status"></p>
    <p id="weight-help" class="sr-only">Choose from 1 to 50 lb per order. Both tiers update as you adjust the weight.</p>
  </div>`;
}
function estimate(p, {heading = false, action = true, headingCategory = null} = {}) {
  const displayCategory=headingCategory||p.category;
  const weight = p.estimatedWeightLb || 30, prices = schedule(p), total = Number.isInteger(weight) ? prices[weight-1] : model.total(p, weight);
  const minimumTotal = minimum(p);
  // Public comparison can choose among eligible destinations. A saved quote
  // derives its allowance from its own frozen costs when no schedule is supplied.
  const included = p.weightTotalsCents && p.minimumIncludedWeightLb != null
    ? p.minimumIncludedWeightLb : model.minimumIncludedWeight(p);
  const atMinimum = included > 0 && weight <= included;
  const rate = atMinimum ? minimumTotal / included : total / weight;
  const caption = atMinimum ? `Minimum-order rate · up to ${included} lb` : `Average price at ${weight} lb`;
  return `<div class="weight-tier" data-weight-tier data-category="${e(p.category)}" data-weight-totals="${e(JSON.stringify(prices))}" data-minimum-total="${minimumTotal}" data-minimum-weight="${included}">
    ${heading ? `<header class="weight-tier-heading"><h2>${names[displayCategory]}</h2><p>${displayCategory==='SUBSCRIPTION'?'Regular pickups. Change or cancel anytime.':'A pickup whenever you need it.'}</p></header>` : ''}
    <div class="weight-price-block"><p class="weight-rate"><strong data-quote-rate>${money(rate)}</strong><span>/ lb</span></p>
    <p class="weight-rate-caption" data-quote-rate-caption>${e(caption)}</p></div>
    <p class="weight-minimum"><strong>${money(minimumTotal)} minimum total</strong>${included>0?`<span>Includes up to ${included} lb</span>`:''}</p>
    <dl class="weight-total"><div><dt>Estimated total <span>for <span data-selected-weight>${e(weight)}</span> lb</span></dt><dd data-quote-total>${money(total)}</dd></div></dl>
    ${heading && action ? `<a class="btn btn-full weight-book ${p.category==='SUBSCRIPTION'?'btn-primary':'btn-outline'}" data-weight-book href="/account/login?next=${encodeURIComponent('/account/book?estimated_weight_lb='+weight+'&plan='+p.category)}">Choose ${p.category==='SUBSCRIPTION'?'subscription':'one-time'}</a>` : '<p class="weight-included">Pickup, return and processing included.</p>'}
    <p class="weight-floor">From ${money(prices[49]/50)}/lb at 50 lb</p>
  </div>`;
}
function publicQuote(quote, address) {
  const sub = quote.categories.SUBSCRIPTION, one = quote.categories.ONE_TIME;
  return `<section class="container weight-quote" data-weight-pricing>
    <header class="weight-quote-heading"><h1>Compare pricing methods.</h1><p>Wash, dry &amp; fold. Pickup, return and processing included.</p></header>
    <div class="weight-address"><p>${e(address)}</p><a href="/pricing">Change address</a></div>
    ${slider(sub.estimatedWeightLb,quote.categories)}
    <div class="weight-tier-grid"><section class="weight-plan">${estimate(sub,{heading:true,action:false})}</section><section class="weight-plan">${estimate(one,{heading:true,action:false})}</section></div>
    <a href="/account/login?next=%2Faccount%2Fbook" class="btn btn-primary btn-lg btn-full">Book a pickup</a>
    <div class="weight-quote-notes"><p>These are preliminary estimates for your address. Choose your pricing method after entering your pickup details. Your final bill is based on the measured weight.</p>
    <details><summary>How the minimum and final price work</summary><div>
      <p>Your minimum covers the weight shown in each tier. The displayed rate stays the same for smaller bags; the minimum total still applies. Above that weight, the displayed rate is the average at your selected weight.</p>
      <p>These are estimates for your address. Pickup date, time and availability may change pricing. After pickup, we recalculate your total from the measured weight using your confirmed quote. Each subscription pickup gets its own quote.</p>
    </div></details></div>
  </section>${script()}`;
}
function script() {
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../public/js/weight-pricing.js'));
  const version=require('node:crypto').createHash('sha256').update(source).digest('hex').slice(0,10);
  return `<script src="/js/weight-pricing.js?v=${version}" defer></script>`;
}
module.exports = {slider, estimate, publicQuote, script};
