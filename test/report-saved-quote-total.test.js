'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const reports=require('../src/core/reports');
const quote={rateCentsPerLb:137,operationalFeeCents:350,minimumTotalCents:1943};
test('expected report total includes the saved fee once and ignores current rates',()=>{
 const order={weight_lb:30,partner_weight_lb:30,pricing_snapshot:quote,price_per_lb_cents:999,price_cents:4460};
 const row=reports.rowFor(order);assert.equal(row.expectedCents,4460);assert.equal(row.chargedCents,4460);assert.equal(order.price_cents,4460);
 assert.match(reports.toCsv([row]),/44.60/);
});
test('saved inclusive minimum and fractional weight rounding match quoted economics',()=>{
 assert.equal(reports.rowFor({weight_lb:1,pricing_snapshot:quote}).expectedCents,1943);
 assert.equal(reports.rowFor({weight_lb:30.001,pricing_snapshot:quote}).expectedCents,4461);
});
test('legacy expected pricing and missing weights remain unchanged',()=>{
 assert.equal(reports.rowFor({weight_lb:30,price_per_lb_cents:137,minimum_cents:1943}).expectedCents,4110);
 assert.equal(reports.rowFor({pricing_snapshot:quote}).expectedCents,null);
});
test('higher billed weight and lower partner payable weight remain independent',()=>{
 const row=reports.rowFor({weight_lb:30,partner_weight_lb:32,pricing_snapshot:quote,partners:{wholesale_per_lb_cents:70}});
 assert.equal(row.billedWeightLb,32);assert.equal(row.expectedCents,4734);assert.equal(row.partnerOwedCents,2100);
});
