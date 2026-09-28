'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const recurring=require('../src/core/recurring'),booking=require('../src/core/booking'),intents=require('../src/core/booking-intents');
test('Sunday morning subscription selected Sunday evening begins next Sunday',t=>{
 t.mock.method(booking,'today',()=> '2026-09-27');
 t.mock.method(booking,'serviceClockOf',()=>({date:'2026-09-27',time:'19:30'}));
 assert.equal(recurring.firstRepeatDate({cadence:'WEEKLY',weekdays:[0],pickupTime:'09:00'}),'2026-10-04');
 assert.equal(intents.firstDateFor({cadence:'WEEKLY',weekdays:'0',pickup_time:'09:00'}),'2026-10-04');
});
test('Sunday pickup remains today when its time is still ahead',t=>{
 t.mock.method(booking,'today',()=> '2026-09-27');
 t.mock.method(booking,'serviceClockOf',()=>({date:'2026-09-27',time:'08:00'}));
 assert.equal(recurring.firstRepeatDate({cadence:'WEEKLY',weekdays:[0],pickupTime:'09:00'}),'2026-09-27');
});
test('one-time bookings retain the explicit date rather than silently rolling forward',()=>{
 assert.equal(intents.firstDateFor({pickup_date:'2026-09-27',pickup_time:'09:00'}),'2026-09-27');
});
