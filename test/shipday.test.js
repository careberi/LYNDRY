'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, cents, delivery } = require('../src/providers/couriers/shipday');

function fixture(results, settings = {}) {
  const calls = [];
  const client = createClient({ apiKey: 'test-key', now: () => 0, ...settings,
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options, parsed: options.body && JSON.parse(options.body) });
      const result = results.shift();
      if (result instanceof Error) throw result;
      return { ok: true, status: 200, json: async () => result };
    } });
  return { client, calls };
}
const endpoint = { line1: '1 Test St', city: 'Test', state: 'NJ', postalCode: '07000', name: 'Test', phone: '+12015550100' };
const trip = { externalId: 'LYNDRY-9000-IN', from: endpoint, to: { ...endpoint, name: 'Wash partner' },
  pickupReadyAt: '2026-09-27T15:00:00Z', dropoffDeadlineAt: '2026-09-27T17:00:00Z' };

test('availability quotes without creating an order and rejects unpriced services', async () => {
  const { client, calls } = fixture([[{ id: 'bad', name: 'Unavailable', fee: null, error: false },
    { id: 'a', name: 'Courier A', fee: 11.99, error: false },
    { id: 'b', name: 'Courier B', fee: 8.99, error: false }]]);
  const quote = await client.quote(trip);
  assert.equal(quote.feeCents, 899);
  assert.equal(quote.service, 'Courier B');
  assert.equal(quote.expirySource, 'LYNDRY');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.shipday.com/on-demand/availability');
  assert.equal(calls[0].headers.Authorization, 'Basic test-key');
  assert.equal(calls[0].parsed.pickUpTime, '2026-09-27T15:00:00.000Z');
});
test('ambiguous additional fees are not presented as an all-in quote', async () => {
  const { client } = fixture([[{ id: 'x', name: 'Courier', fee: 8, regulatoryFee: 2, error: false }]]);
  assert.equal((await client.quote(trip)).ok, false);
});
test('write access is disabled by default, before any network call', async () => {
  const { client, calls } = fixture([]);
  await assert.rejects(client.createOrder(trip), /disabled/);
  await assert.rejects(client.cancel(123), /disabled/);
  assert.equal(calls.length, 0);
});
test('creation maps the pickup to restaurant and dropoff to customer without assigning', async () => {
  const { client, calls } = fixture([{ success: true, orderId: 123 }], { allowWrites: true });
  assert.equal((await client.createOrder(trip)).id, '123');
  assert.equal(calls[0].parsed.restaurantName, 'Test');
  assert.equal(calls[0].parsed.customerName, 'Wash partner');
  assert.equal(calls.length, 1);
});
test('assignment re-quotes and stops when the operational trip budget is exceeded', async () => {
  const { client, calls } = fixture([{ id: 'q', name: 'Courier', fee: 10, error: false }], { allowWrites: true });
  assert.equal((await client.assign(123, { maxFeeCents: 999 })).quoteChanged, true);
  assert.equal(calls.length, 1);
});
test('assignment passes the current estimate and handover requirement', async () => {
  const { client, calls } = fixture([{ id: 'q', name: 'Courier', fee: 10, error: false },
    { orderId: 123, status: 'ASSIGNED', totalBillableAmount: 10 }], { allowWrites: true });
  const result = await client.assign(123, { maxFeeCents: 1000, requirePin: true });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ASSIGNED');
  assert.equal(calls[1].parsed.podType, 'PIN');
  assert.equal(calls[1].parsed.estimateReference, 'q');
});
test('ambiguous mutation failure is never retried and never exposes credentials', async () => {
  const { client, calls } = fixture([new Error('test-key private vendor details')], { allowWrites: true });
  await assert.rejects(client.createOrder(trip), (error) => error.uncertain === true && !error.message.includes('test-key'));
  assert.equal(calls.length, 1);
});
test('cancellation requires explicit success', async () => {
  const { client } = fixture([{}, { success: true }], { allowWrites: true });
  assert.equal((await client.cancel(123)).ok, false);
  assert.equal((await client.cancel(123)).ok, true);
});
test('status rejects another order and preserves unknown costs and statuses', () => {
  assert.throws(() => delivery({ orderId: 124 }, 123), /different/);
  const state = delivery({ orderId: 123, status: 'SOMETHING_NEW', trackingUrl: 'javascript:alert(1)' }, 123);
  assert.equal(state.status, 'SOMETHING_NEW');
  assert.equal(state.feeCents, null);
  assert.equal(state.trackingUrl, null);
  assert.equal(cents(null), null);
  assert.equal(cents(-1), null);
  assert.equal(cents(11.99), 1199);
});

test('in-house assignment accepts documented empty 204 and refuses offline drivers',async()=>{
 const calls=[];
 const client=createClient({apiKey:'test',allowWrites:true,fetchImpl:async(url,options)=>{calls.push({url,...options});return url.endsWith('/carriers')?{ok:true,status:200,json:async()=>[{id:7,name:'House',isActive:true,isOnShift:true}]}:{ok:true,status:204,json:async()=>{throw Error('No body');}};}});
 assert.equal((await client.assignDriver(123,7)).ok,true);assert.equal(calls[1].method,'PUT');assert.ok(calls[1].url.endsWith('/orders/assign/123/7'));
 assert.equal((await client.assignDriver(123,8)).ok,false);assert.equal(calls.length,3);
});

test('scheduled assignment excludes early arrivals, unsupported couriers, fees and closed-shop estimates',async()=>{
 const offer={id:'q',name:'Uber',fee:7.5,error:false,pickupTime:'2026-09-28T20:00:00Z',deliveryTime:'2026-09-28T20:25:00Z'};
 for(const patch of [{pickupTime:'2026-09-28T19:45:00Z'},{pickupTime:'2026-09-28T21:00:00Z'},{name:'Other'},{fee:8},{regulatoryFee:1},{pickupTime:null},{deliveryTime:null}]){
  const {client,calls}=fixture([[{...offer,...patch}]],{allowWrites:true});
  assert.equal((await client.assign(123,{maxFeeCents:750,pickupReadyAt:offer.pickupTime})).ok,false);assert.equal(calls.length,1);
 }
 const closed=fixture([[offer]],{allowWrites:true});assert.equal((await closed.client.assign(123,{maxFeeCents:750,pickupReadyAt:offer.pickupTime,acceptEstimate:()=>false})).ok,false);
 let checked=false;const good=fixture([[offer],{orderId:123,status:'REQUESTED',thirdPartyName:'Uber'}],{allowWrites:true});
 const result=await good.client.assign(123,{maxFeeCents:750,pickupReadyAt:offer.pickupTime,trip,beforeAssign:async()=>{checked=true;}});
 assert.equal(checked,true);assert.equal(result.status,'REQUESTED');assert.equal(good.calls[1].parsed.podType,'PHOTO');
 assert.equal(good.calls[0].url,'https://api.shipday.com/on-demand/availability');assert.equal(good.calls[0].parsed.pickUpTime,'2026-09-28T20:00:00.000Z');assert.equal(good.calls[1].parsed.estimateReference,'q');
 const changed=fixture([[offer]],{allowWrites:true});await assert.rejects(changed.client.assign(123,{maxFeeCents:750,pickupReadyAt:offer.pickupTime,beforeAssign:async()=>{throw Error('Payment changed');}}),/Payment changed/);assert.equal(changed.calls.length,1);
});
