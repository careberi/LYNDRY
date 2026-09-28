'use strict';
const {escapeHtml:e}=require('./layout');
const economics=require('../core/pricing-economics');
const money=n=>'$'+(n/100).toFixed(2);
function prices(snapshot,title){
 if(!snapshot)return '';
 const rows=[['Wash, dry & fold',money(snapshot.rateCentsPerLb)+'/lb'],['Operational fee',money(snapshot.operationalFeeCents)],['Estimated total · 30–40 lb',money(economics.quotedTotal({...snapshot,weightLb:30}))+'–'+money(economics.quotedTotal({...snapshot,weightLb:40}))],['Minimum total',money(snapshot.minimumTotalCents)],['Maximum · 50 lb',money(economics.quotedTotal({...snapshot,weightLb:50}))]];
 return '<section class="order-price-panel"><h3>'+e(title)+'</h3><dl>'+rows.map(([key,value])=>'<div><dt>'+e(key)+'</dt><dd>'+e(value)+'</dd></div>').join('')+'</dl><p class="hint">Totals include the operational fee. Final weight determines the bill.</p></section>';
}
function orderOverview({order,customer,shop,quote,problem,selector,canMoney,canCustomer,deliverySync=[]}){
 const prefs=order.preferences&&Object.keys(order.preferences).length?order.preferences:customer.preferences||{};
 const address=p=>p?[p.address_line1,p.address_line2,p.city,p.state,p.postal_code].filter(Boolean).join(', '):'';
 const saved=order.pricing_snapshot;
 // Reuse the existing guarded destination form without repeating its old heading and assignment text.
 const destinationForm=selector ? (selector.match(/<form[\s\S]*?<\/form>/)?.[0] || '') : '';
 const category=saved?.category==='WHOLESALE'?'Wholesale':saved?.category==='SUBSCRIPTION'||order.subscription_id||order.from_schedule?'Recurring pickup':'One-time pickup';
 const facts=[['Pickup address',address(customer)],['Pickup date',require('../core/format').displayDate(order.pickup_date)],['Requested time',require('../core/booking').requestedPickupLabel(order)],['Pickup location',prefs.dropoff_spot||prefs.special_instructions||customer.preferences?.dropoff_spot||customer.preferences?.special_instructions||({LEAVE_OUTSIDE:'Leave outside',HAND_TO_DRIVER:'Hand to driver'})[order.pickup_method]||order.pickup_method||'Not recorded'],['Service',category],['Wash instructions',require('../core/wash').washLines(prefs).map(line=>Array.isArray(line)?line.join(': '):line).join(' · ')||'Not recorded']];
 return '<section class="order-overview"><h2>Order details</h2><div class="order-overview-grid"><section><dl class="order-facts">'+facts.map(([k,v])=>'<div><dt>'+e(k)+'</dt><dd>'+e(v||'Not recorded')+'</dd></div>').join('')+(canCustomer?'<a href="/ops/customers/'+e(customer.id)+'">Customer profile and field actions →</a>':'')+'</section><section><h3>Destination laundromat</h3><strong>'+e(shop?.name||'Not assigned')+'</strong><p>'+e(address(shop))+'</p>'+(canMoney&&shop?.wholesale_per_lb_cents?'<p class="hint">Laundromat cost to LYNDRY: '+money(shop.wholesale_per_lb_cents)+'/lb</p>':'')+(destinationForm?'<div id="laundromat">'+destinationForm+'<p class="hint">Changing the destination updates this order’s pricing.</p></div>':'')+'</section></div></section>'+syncStatus(order,deliverySync)+(canMoney?'<section class="order-overview"><h2>Order pricing</h2><div class="order-overview-grid">'+prices(saved,'Order pricing')+prices(quote,'Current destination estimate')+'</div>'+(problem?'<p role="alert">'+e(problem)+'</p>':'')+(!saved?'<p>No saved dynamic quote on this order.</p>':'')+'<p class="hint">A laundromat change recalculates and saves the price shown here. Final weight determines the total.</p>'+'<p class="hint">Development courier estimates are simulated. Delivery changes sync to the linked Shipday order. Check its sync status above.</p></section>':'');
}
function syncStatus(order,rows){
 if(!rows.length)return '';
 return '<section class="order-overview"><h2>Shipday delivery sync</h2>'+rows.map(row=>'<p><strong>'+(row.leg==='TO_PARTNER'?'Pickup':'Return')+': '+({SYNCED:'Up to date',PENDING:'Update pending',PROCESSING:'Updating',REVIEW:'Needs attention'})[row.state]+'</strong></p>'+(row.problem?'<p role="alert">'+e(row.problem)+'</p>':'')).join('')+'<form method="post" action="/ops/orders/'+e(order.order_number)+'/sync-shipday"><button class="btn" type="submit">Check and sync Shipday</button></form></section>';
}
module.exports={orderOverview,prices,syncStatus};
