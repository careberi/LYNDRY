'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {orderOverview,prices}=require('../src/web/order-overview');
const saved={rateCentsPerLb:154,operationalFeeCents:400,minimumTotalCents:1979,category:'SUBSCRIPTION'};
test('order overview shows saved terms, inclusive bounds, destination and order-snapshot instructions',()=>{
 const html=orderOverview({order:{order_number:9015,pickup_date:'2026-09-28',pickup_time:'09:00',pricing_snapshot:saved,preferences:{water_temp:'cold',dropoff_spot:'Front door'}},customer:{id:'c',address_line1:'25 Windham Pl',preferences:{water_temp:'hot'}},shop:{name:'Destination',address_line1:'Shop road',wholesale_per_lb_cents:95},canMoney:true,canCustomer:true});
 for(const text of ['Order details','Destination','Shop road','Front door','Recurring pickup','$1.54/lb','$19.79','$81.00','$50.20–$65.60','Customer profile and field actions'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/Customer fields/);
 const legacySpot=orderOverview({order:{order_number:2},customer:{preferences:{special_instructions:'Side porch'}},canMoney:false});
 assert.match(legacySpot,/Side porch/);
});
test('archived proposals are not shown; saved pricing remains permission controlled',()=>{
 const args={order:{order_number:1,pricing_snapshot:saved,pending_pricing_snapshot:{...saved,rateCentsPerLb:200}},customer:{},shop:{name:'Shop'},canMoney:true};
 const html=orderOverview(args);assert.doesNotMatch(html,/awaiting approval|\/spending|\$104.00/);assert.match(html,/\$81.00/);
 assert.doesNotMatch(orderOverview({...args,canMoney:false}),/\$|Order pricing/);
 assert.ok(prices({...saved,minimumTotalCents:10000},'Minimum').includes('$100.00'));
});

test('pickup and return IDs come from separate linked trips, not the order number',()=>{
 const html=orderOverview({order:{order_number:9019},customer:{},deliveryPlans:[{leg:'TO_CUSTOMER',shipday_order_id:'222'},{leg:'TO_PARTNER',shipday_order_id:'111'}]});
 assert.match(html,/<dt>Pickup · Shipday \/ LYNDRY<\/dt><dd>111 \/ #9019<\/dd>/);
 assert.match(html,/<dt>Return · Shipday \/ LYNDRY<\/dt><dd>222 \/ #9019<\/dd>/);
 const missing=orderOverview({order:{order_number:9019},customer:{}});
 assert.equal((missing.match(/Not linked yet/g)||[]).length,2);
});

test('canceled order warns until linked Shipday cancellation is confirmed',()=>{const args={order:{order_number:1,status:'CANCELED'},customer:{},deliveryPlans:[{leg:'TO_PARTNER',shipday_order_id:'123',state:'REVIEW'}]};assert.match(orderOverview(args),/Shipday cancellation is not yet confirmed/);args.deliveryPlans[0].state='CANCELED';assert.doesNotMatch(orderOverview(args),/Shipday cancellation is not yet confirmed/);});
