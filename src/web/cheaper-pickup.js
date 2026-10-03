
'use strict';
const {escapeHtml:e}=require('./layout');
const {total}=require('../core/cheaper-pickup');
const weightModel=require('../core/weight-based-pricing');
function rate(snapshot,weight) { const included=weightModel.isSnapshot(snapshot)?weightModel.minimumIncludedWeight(snapshot):0;return included>0&&weight<=included?snapshot.minimumTotalCents/included:total(snapshot)/weight; }
function whenLine(pickupDate,pickupTime) {
  const date=new Date(pickupDate+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  const hour=Number(pickupTime.slice(0,2)),minute=pickupTime.slice(3,5);
  return date+' at '+(hour%12||12)+':'+minute+' '+(hour<12?'AM':'PM')+' Eastern';
}
function render(offer,given) {
  const weight=Number(given.estimated_weight_lb||30);
  const params=new URLSearchParams({pickup_updated:'yes',address_confirmed:'yes',pickup_date:offer.pickup_date,pickup_time:offer.pickup_time,alternative_partner_id:offer.alternative_partner_id,estimated_weight_lb:String(given.estimated_weight_lb||30)});
  const when=whenLine(offer.pickup_date,offer.pickup_time);
  return `<aside class="card" style="padding:22px;margin-bottom:24px;" aria-label="Cheaper pickup alternative"><h2>Choose a cheaper alternative</h2><p>${e(when)}</p><p>Subscription: <strong>$${(rate(offer.categories.SUBSCRIPTION,weight)/100).toFixed(2)}</strong> /lb estimated.<br>One-time pickup: <strong>$${(rate(offer.categories.ONE_TIME,weight)/100).toFixed(2)}</strong> /lb estimated.</p><p>For an estimated ${e(given.estimated_weight_lb||30)} lb bag. Your final bill uses the measured weight. Availability is checked again when you select this pickup.</p><a class="btn btn-outline" href="/account/book?${e(params.toString())}">Use this pickup date and time</a></aside>`;
}
module.exports={render,whenLine};
