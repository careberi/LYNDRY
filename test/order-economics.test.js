 'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {calculate,render}=require('../src/web/order-economics');
const {orderOverview}=require('../src/web/order-overview');
const order={weight_lb:33,billable_weight_lb:33,price_cents:6038,payment_status:'PAID',pricing_snapshot:{wholesaleCentsPerLb:70,customerBaseCentsPerLb:100,rateCentsPerLb:130,operationalFeeCents:1748,minimumTotalCents:1500,pickupCents:699,returnCents:699,pricingMethod:'COST_PLUS_MARGIN_15',feeCalculation:'TRANSPORT_MARGIN_V2',policy:{processingBps:290,processingFixedCents:30,operationalFeeBps:2500}}};
test('cost breakdown uses wholesale, saved fees and measured weight, never customer pricing base',()=>{
 const r=calculate(order);assert.equal(r.washing,2310);assert.equal(r.processing,205);assert.equal(r.totalCost,3913);assert.equal(r.profit,2125);assert.equal(r.laundry,4290);
 const html=render(order);for(const text of ['$60.38','$21.25','35.2%','$11.12','$4.37','$1.99'])assert.ok(html.includes(text),text);
});
test('settled partner weight and recorded courier costs override estimates including zero',()=>{
 const r=calculate({...order,partner_bill_lb:30},[],[{leg:'TO_PARTNER',delivery_id:'a',fee_cents:0},{leg:'TO_CUSTOMER',delivery_id:'b',fee_cents:900}]);
 assert.equal(r.washing,2100);assert.equal(r.courier[0].value,0);assert.equal(r.courier[1].value,900);assert.equal(r.totalCost,3205);
});
test('processing respects cash and multiple card transactions',()=>{
 assert.equal(calculate(order,[{method:'CASH',amount_cents:6038}]).processing,0);
 assert.equal(calculate(order,[{method:'CARD',amount_cents:3000},{method:'CARD',amount_cents:3038}]).processing,235);
});
test('missing costs and unweighed orders do not fabricate profit',()=>{
 assert.equal(calculate({...order,weight_lb:null,billable_weight_lb:null}).profit,null);
 assert.equal(calculate({...order,pricing_snapshot:{...order.pricing_snapshot,pickupCents:null}}).profit,null);
 assert.equal(calculate({...order,price_cents:0}).margin,null);
 assert.match(render({...order,payment_status:'UNPAID'}),/Projected only/);
});
test('losses stay negative and money permissions hide the entire breakdown',()=>{
 assert.ok(calculate({...order,price_cents:1000}).profit<0);
 const args={order,customer:{},canMoney:false};assert.doesNotMatch(orderOverview(args),/Business costs|Estimated order profit|Customer charges/);
 assert.match(orderOverview(args),/Pickup weight/);assert.match(orderOverview(args),/33 lb/);
});
