'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const promotions=require('../src/core/promotions');
const fulfilment=require('../src/core/fulfilment');
const consolePage=require('../src/web/order-console');
test('the board distinguishes uncharged gross prices from settled prices',()=>{
  const money=c=>`$${(c/100).toFixed(2)}`;
  assert.match(consolePage.pickupPriceCell({price_cents:5000,payment_status:'UNPAID'},{money}),/Before discounts.*not charged/);
  assert.equal(consolePage.pickupPriceCell({price_cents:2500,payment_status:'PAID'},{money}),'$25.00');
});
test('pickup preview includes the unused first-order discount without redeeming it',async t=>{
  t.mock.method(promotions,'discountFor',async()=>({cents:2500,promotion:{id:'p',name:'50% off'}}));
  t.mock.method(promotions,'redeem',async()=>assert.fail('preview must not spend a grant'));
  const quote=await fulfilment.pickupQuote({weight_lb:25,price_per_lb_cents:200,minimum_cents:2500,customers:{id:'c'}});
  assert.equal(quote.priceCents,2500);assert.equal(quote.beforeDiscount,5000);assert.equal(quote.discountCents,2500);
  const html=consolePage.pickupQuoteBox(quote,{money:c=>`$${(c/100).toFixed(2)}`});
  assert.match(html,/Expected total/);assert.match(html,/\$25.00/);assert.match(html,/not charged/i);
});
test('a failed discount lookup cannot silently become full price',async t=>{
  t.mock.method(promotions,'discountFor',async()=>{throw Error('discount database unavailable');});
  await assert.rejects(()=>fulfilment.pickupQuote({weight_lb:25,price_per_lb_cents:200,customers:{id:'c'}}),/discount database/);
});
test('minimum and surcharges remain part of the quote',async t=>{
  t.mock.method(promotions,'discountFor',async()=>null);
  const q=await fulfilment.pickupQuote({weight_lb:5,price_per_lb_cents:200,minimum_cents:2500,surcharge_cents:200,customers:{id:'c'}});
  assert.equal(q.priceCents,2700);
});
