'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const timing=require('../src/core/pickup-timing');
test('late evening travel plus buffer fits before midnight without a fixed hour',()=>{
 const pickup='2026-09-29T03:10:00Z';
 const q={options:[{service:'Uber',pickupTime:'2026-09-29T03:20:00Z',deliveryTime:'2026-09-29T03:35:00Z'}]};
 assert.equal(timing.inHouseArrival(q,pickup,10),'2026-09-29T03:35:00.000Z');
 assert.equal(timing.localArrival(timing.inHouseArrival(q,pickup,10)),'2026-09-28 23:35');
 assert.equal(timing.inHouseArrival({options:[]},pickup),null);
 assert.equal(timing.manualArrival('2026-09-28T23:35',pickup),'2026-09-29T03:35:00.000Z');
 assert.throws(()=>timing.manualArrival('2026-09-28T23:00',pickup),/after pickup/);
 assert.throws(()=>timing.bufferMinutes(-1));assert.throws(()=>timing.bufferMinutes(1.5));
});
test('arrival hours and turnaround use the same check for booking and dispatch',()=>{
 const {scheduleFits}=require('../src/core/dev-checkout');
 const hours=[{weekday:1,opens_at:'07:00',closes_at:'23:59'},{weekday:2,opens_at:'07:00',closes_at:'20:00'}];
 const shop={turnaround_minutes:12*60};
 assert.equal(scheduleFits(shop,hours,'2026-09-28','23:10','2026-09-29T03:35:00Z'),true);
 assert.equal(scheduleFits(shop,hours,'2026-09-28','23:10','2026-09-29T04:10:00Z'),false);
 assert.equal(scheduleFits({...shop,turnaround_minutes:24*60},hours,'2026-09-28','23:10','2026-09-29T03:35:00Z'),false);
});
