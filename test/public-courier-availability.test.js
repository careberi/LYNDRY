'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requiredFee, verifyRoundTrip } = require('../src/core/public-courier-availability');

const quote = (options, expiresAt = '2030-01-01T00:05:00.000Z') => ({ ok: true, options, expiresAt });
const both = (uber, doorDash) => [
  { service: 'Uber', feeCents: uber },
  { service: 'DoorDash Drive', feeCents: doorDash },
];

test('a public price uses the cheapest supported confirmed courier', () => {
  assert.equal(requiredFee(quote(both(674, 750))), 674);
  assert.equal(requiredFee(quote([{ service: 'Uber', feeCents: 674 }])), 674);
  assert.equal(requiredFee({ ok: false, options: both(674, 750) }), null);
});

test('round-trip verification checks each direction without creating an order', async () => {
  const calls = [];
  const results = [quote(both(674, 750)), quote(both(700, 825), '2030-01-01T00:04:00.000Z')];
  const client = { quote: async (trip) => { calls.push(trip); return results.shift(); } };
  const customer = { line1: '1 Customer St' };
  const partner = { line1: '2 Laundry Ave' };
  const verified = await verifyRoundTrip(client, { customer, partner });
  assert.deepEqual(calls, [{ from: customer, to: partner }, { from: partner, to: customer }]);
  assert.deepEqual(verified, {
    pickupCents: 674,
    returnCents: 700,
    source: 'SHIPDAY',
    expiresAt: '2030-01-01T00:04:00.000Z',
  });
});

test('a direction with no valid courier withholds the public price', async () => {
  const client = { quote: async ({ from }) => from.line1 === '1 Customer St'
    ? quote(both(674, 750))
    : quote([{ service: 'Uber', feeCents: null }]) };
  assert.equal(await verifyRoundTrip(client, {
    customer: { line1: '1 Customer St' }, partner: { line1: '2 Laundry Ave' },
  }), null);
});

test('scheduled availability cannot replace the address price with a higher courier fee',async()=>{
 const pickupReadyAt='2030-01-01T17:00:00Z';
 const client={quote:async()=>quote([
  {service:'Uber',feeCents:674,pickupTime:'2030-01-01T16:58:00Z',deliveryTime:'2030-01-01T17:20:00Z'},
  {service:'DoorDash',feeCents:750,pickupTime:pickupReadyAt,deliveryTime:'2030-01-01T17:15:00Z'}
 ])};
 const args={customer:{},partner:{},pickupReadyAt};
 assert.ok(await verifyRoundTrip(client,{...args,acceptArrival:at=>Date.parse(at)<Date.parse('2030-01-01T17:40:00Z')}));
 const scheduled=await verifyRoundTrip(client,{...args,acceptArrival:at=>Date.parse(at)<Date.parse('2030-01-01T17:25:00Z')});
 assert.equal(scheduled.pickupCents,674);
 assert.equal(scheduled.pickupEstimateAt,pickupReadyAt);
 assert.deepEqual(scheduled.arrivalChecks,['2030-01-01T17:15:00Z']);
 assert.equal(await verifyRoundTrip(client,{...args,acceptArrival:()=>false}),null);
});

test('booking uses the same address-only pricing requests as public quote plus a separate timing check',async()=>{
 const customer='Home',partner='Shop',pickupReadyAt='2030-01-01T17:00:00Z',calls=[];
 const client={quote:async trip=>{calls.push(trip);return quote(trip.pickupReadyAt?
  [{service:'DoorDash',feeCents:950,pickupTime:pickupReadyAt,deliveryTime:'2030-01-01T17:15:00Z'}]:both(674,750));}};
 const result=await verifyRoundTrip(client,{customer,partner,pickupReadyAt});
 assert.equal(result.pickupCents,674);assert.equal(result.returnCents,674);
 assert.deepEqual(calls,[{from:customer,to:partner},{from:partner,to:customer},{from:customer,to:partner,pickupReadyAt}]);
});

test('unavailable or stale scheduled estimates block booking despite valid address prices',async()=>{
 const pickupReadyAt='2030-01-01T17:00:00Z';let scheduled={ok:false,options:[]};
 const client={quote:async trip=>trip.pickupReadyAt?scheduled:quote(both(674,750))};
 const args={customer:'Home',partner:'Shop',pickupReadyAt};
 assert.equal(await verifyRoundTrip(client,args),null);
 scheduled={reason:'pickup_time_rejected'};
 await assert.rejects(verifyRoundTrip(client,args),{code:'PICKUP_TIME_REJECTED'});
 scheduled=quote([{service:'Uber',feeCents:674,pickupTime:pickupReadyAt,deliveryTime:'2030-01-01T17:15:00Z'}],'2000-01-01');
 await assert.rejects(verifyRoundTrip(client,args),/fresh/);
});

test('invalid, unsupported and fee-review offers cannot undercut a valid quote',()=>{
 assert.equal(requiredFee(quote([{service:'Uber',feeCents:-1},{service:'DoorDash',feeCents:649},{service:'Other',feeCents:1},{service:'Uber',feeCents:100,requiresFeeReview:true}])),649);
});
