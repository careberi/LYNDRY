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


test('earliest pickup has preparation time and rounds forward across midnight',()=>{
 assert.equal(typeof timing.resolvePickup,'function');
 const r=timing.resolvePickup({pickup_mode:'EARLIEST'},{now:Date.parse('2026-10-03T03:50:01Z')});
 assert.equal(r.pickup_date,'2026-10-03');assert.equal(r.pickup_time,'00:15');assert.equal(r.pickupReadyAt,'2026-10-03T04:15:00.000Z');
});
test('scheduled pickup never silently moves and rejects ambiguous daylight saving time',()=>{
 assert.equal(typeof timing.resolvePickup,'function');
 const now=Date.parse('2026-10-02T21:00:01Z');
 assert.throws(()=>timing.resolvePickup({pickup_mode:'SCHEDULED',pickup_date:'2026-10-02',pickup_time:'17:00'},{now}),/later|ahead/);
 assert.equal(timing.resolvePickup({pickup_mode:'SCHEDULED',pickup_date:'2026-10-02',pickup_time:'18:00'},{now}).pickupReadyAt,'2026-10-02T22:00:00.000Z');
 assert.throws(()=>timing.resolvePickup({pickup_mode:'SCHEDULED',pickup_date:'2026-11-01',pickup_time:'01:30'},{now}),/valid|ambiguous/);
 assert.throws(()=>timing.resolvePickup({pickup_mode:'SCHEDULED',pickup_date:'2027-03-14',pickup_time:'02:30'},{now}),/valid|ambiguous/);
});
test('a saved pickup stays fixed while checkout proceeds and requires refresh when too close',()=>{
 assert.equal(typeof timing.validateSavedPickup,'function');
 assert.equal(timing.validateSavedPickup('2026-10-02T22:00:00.000Z',{now:Date.parse('2026-10-02T21:45:00Z')}),'2026-10-02T22:00:00.000Z');
 assert.throws(()=>timing.validateSavedPickup('2026-10-02T22:00:00.000Z',{now:Date.parse('2026-10-02T21:59:30Z')}),/refresh|Refresh/);
});
test('customer timing distinguishes readiness from the courier estimate in Eastern time',()=>{
 const html=require('../src/web/booking-price').pickupTiming({pickupReadyAt:'2026-10-05T14:00:00Z',pickupEstimateAt:'2026-10-05T14:12:00Z'});
 assert.match(html,/Have your bag ready Oct 5, 10:00 AM/);
 assert.match(html,/Estimated courier pickup: Oct 5, 10:12 AM/);
 assert.match(html,/Arrival may change/);
});
