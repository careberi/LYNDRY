'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {estimate}=require('../src/core/in-house-quote');
const routing={wagePerHour:20,gasPerGallon:3.4,milesPerGallon:22,wearPerMile:0.18,milesPerHour:24,roadFactor:1.3,minutesPerPickup:4,minutesPerDelivery:4,minutesPerPartnerVisit:10};
test('in-house estimates retain configured labour fuel wear and travel without a vendor',()=>{
 const q=estimate(3,routing);assert.equal(q.source,'IN_HOUSE');assert.ok(q.pickupCents>0);assert.ok(q.returnCents>0);assert.equal(q.travelMinutes,10);assert.equal(q.costBasis,'CONFIGURED_IN_HOUSE_ESTIMATE');
});
test('invalid routing settings never invent zero delivery costs',()=>{assert.throws(()=>estimate(3,{...routing,milesPerHour:0}),/routing/i);});
