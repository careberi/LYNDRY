'use strict';
const {escapeHtml:e}=require('./layout');
const economics=require('../core/pricing-economics');
const money=n=>'$'+(n/100).toFixed(2);
function prices(snapshot,title){
 if(!snapshot)return '';
 const model=require('../core/weight-based-pricing');
 const rows=model.isSnapshot(snapshot)?[['Estimated bag weight',snapshot.estimatedWeightLb+' lb'],['Inclusive estimate',money(model.total(snapshot,snapshot.estimatedWeightLb))],['Minimum total',money(snapshot.minimumTotalCents)],['Total at 50 lb',money(model.total(snapshot,50))],['Billing','Recalculated at measured weight; delivery and processing included']]:[['Wash, dry & fold',money(snapshot.rateCentsPerLb)+'/lb'],[require('./pricing-label')(snapshot),money(snapshot.operationalFeeCents)],['Estimated total · 30–40 lb',money(economics.quotedTotal({...snapshot,weightLb:30}))+'–'+money(economics.quotedTotal({...snapshot,weightLb:40}))],['Minimum total',money(snapshot.minimumTotalCents)],['Maximum · 50 lb',money(economics.quotedTotal({...snapshot,weightLb:50}))]];
 return '<section class="order-price-panel"><h3>'+e(title)+'</h3><dl>'+rows.map(([key,value])=>'<div><dt>'+e(key)+'</dt><dd>'+e(value)+'</dd></div>').join('')+'</dl><p class="hint">Totals include fees. Final weight determines the bill.</p></section>';
}
function orderOverview({order,customer,shop,quote,problem,selector,canMoney,canCustomer,deliverySync=[],deliveryPlans=[],paymentRows=[],courierRows=[]}){
 customer=require('../core/order-address').customerFor(order,customer);
 const prefs=order.preferences&&Object.keys(order.preferences).length?order.preferences:customer.preferences||{};
 const address=p=>p?[p.address_line1,p.address_line2,p.city,p.state,p.postal_code].filter(Boolean).join(', '):'';
 const saved=order.pricing_snapshot;
 const destinationForm=selector ? (selector.match(/<form[\s\S]*?<\/form>/)?.[0] || '') : '';
 const category=saved?.category==='WHOLESALE'?'Wholesale':saved?.category==='SUBSCRIPTION'?'Recurring pickup':saved?.category==='ONE_TIME'?'One-time pickup':order.subscription_id||order.from_schedule?'Recurring pickup':'One-time pickup';
 const facts=[['Destination laundromat',shop?.name||'Not assigned'],['Laundromat address',address(shop)],['Pickup weight',order.weight_lb!=null?order.weight_lb+' lb':'Not weighed yet'],['Billable weight',order.billable_weight_lb!=null?order.billable_weight_lb+' lb':'Not finalized'],['Laundromat weight',order.partner_weight_lb!=null?order.partner_weight_lb+' lb':'Not recorded'],['Pickup address',address(customer)],['Pickup date',require('../core/format').displayDate(order.pickup_date)],['Requested time',require('../core/booking').requestedPickupLabel(order)],['Pickup location',prefs.dropoff_spot||prefs.special_instructions||customer.preferences?.dropoff_spot||customer.preferences?.special_instructions||({LEAVE_OUTSIDE:'Leave outside',HAND_TO_DRIVER:'Hand to driver'})[order.pickup_method]||order.pickup_method||'Not recorded'],['Service',category],['Wash instructions',require('../core/wash').washLines(prefs).map(line=>Array.isArray(line)?line.join(': '):line).join(' · ')||'Not recorded']];
 const tripId=leg=>{const plan=deliveryPlans.find(p=>p.leg===leg);return plan?.shipday_order_id?String(plan.shipday_order_id):'Not linked yet';};
 facts.splice(2,0,['Shipday pickup ID',tripId('TO_PARTNER')],['Shipday return ID',tripId('TO_CUSTOMER')]);
 const destination=destinationForm?'<details id="laundromat"><summary>Change destination laundromat</summary>'+destinationForm+'<p class="hint">Changing the destination updates this order’s pricing.</p></details>':'';
 const quotePanel=canMoney?'<div class="order-quote-column">'+(prices(saved,'Saved quote')||'<section class="order-price-panel"><h3>Saved quote</h3><p>No saved dynamic quote on this order.</p></section>')+prices(quote,'Current destination estimate')+(problem?'<p role="alert">'+e(problem)+'</p>':'')+'<p class="hint">A laundromat change recalculates and saves the price shown here. Final weight determines the total.</p></div>':'';
 return '<section class="order-overview"><div class="order-overview-grid'+(!canMoney?' order-overview-grid-single':'')+'"><section><h2>Order details</h2><dl class="order-facts">'+facts.map(([k,v])=>'<div><dt>'+e(k)+'</dt><dd>'+e(v||'Not recorded')+'</dd></div>').join('')+'</dl>'+destination+(canCustomer?'<a href="/ops/customers/'+e(customer.id)+'">Customer profile and field actions →</a>':'')+'</section>'+quotePanel+'</div></section>'+syncStatus(order,deliverySync)+(canMoney?'<section class="order-overview"><h2>Payment and pricing</h2>'+require('./order-economics').render(order,paymentRows,courierRows)+(order.payment_status==='PAID'&&order.price_cents!=null?'<p class="pos-payment-total">Paid: <strong>'+money(order.price_cents)+'</strong></p>':'')+'<p class="hint">Development courier estimates are simulated. Delivery changes sync to the linked Shipday order. Check its sync status above.</p></section>':'');
}
function syncStatus(order,rows){
 if(!rows.length)return '';
 return '<section class="order-overview"><h2>Delivery details sync</h2><p class="hint">This reports whether delivery details were synchronized. It does not confirm pickup or delivery; check dispatch status above.</p>'+rows.map(row=>'<p><strong>'+(row.leg==='TO_PARTNER'?'Pickup':'Return')+': '+({SYNCED:'Up to date',PENDING:'Update pending',PROCESSING:'Updating',REVIEW:'Needs attention'})[row.state]+'</strong></p>'+(row.problem?'<p role="alert">'+e(row.problem)+'</p>':'')).join('')+'<form method="post" action="/ops/orders/'+e(order.order_number)+'/sync-shipday"><button class="btn" type="submit">Check and sync Shipday</button></form></section>';
}
module.exports={orderOverview,prices,syncStatus};
