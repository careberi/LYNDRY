'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepare}=require('../src/core/order-details-edit');
test('stale order forms fail before any quoting or persistence',async()=>{
 await assert.rejects(require('../src/core/order-details-edit').save(order,{...form,expected:'{}'},{id:'admin'}),/Order changed/);
});
const {customerFor}=require('../src/core/order-address');
const {editor}=require('../src/web/order-details-edit');
const order={status:'REQUESTED',payment_status:'UNPAID',order_number:9017,preferences:{water_temp:'COLD'},customers:{address_line1:'Original home',lat:1,lng:2}};
const form={address_line1:'16 Test Street',address_line2:'2B',city:'Fair Lawn',state:'NJ',postal_code:'07410',pickup_date:'2099-09-28',pickup_time:'16:00',service:'ONE_TIME',dropoff_spot:'Front door',water_temp:'WARM',fabric_softener:'NONE'};
test('order edits validate all editable fields and keep the customer home unchanged',()=>{
 const change=prepare(order,form);const c=customerFor({...order,preferences:change.preferences},order.customers);
 assert.equal(c.address_line1,'16 Test Street');assert.equal(c.lat,null);assert.equal(c.order_address_override,true);assert.equal(order.customers.address_line1,'Original home');
 assert.equal(change.preferences.water_temp,'WARM');assert.equal(change.pickup_time,'16:00');
});
test('invalid addresses, schedules, wash choices and collected orders are refused',()=>{
 for(const patch of [{postal_code:'123'},{state:'NY'},{pickup_date:'2000-01-01'},{pickup_time:'25:01'},{water_temp:'BOILING'},{service:'FREE'},{address_line1:''}])assert.throws(()=>prepare(order,{...form,...patch}));
 assert.throws(()=>prepare({...order,status:'AT_PARTNER'},form),/before collection/);
});
test('the order editor escapes addresses and exposes only supported wash preferences',()=>{
 const html=editor(order,{address_line1:'<script>bad</script>'});
 for(const name of ['address_line1','address_line2','city','state','postal_code','pickup_date','pickup_time','dropoff_spot','service','water_temp','fabric_softener'])assert.match(html,new RegExp('name="'+name+'"'));
 assert.doesNotMatch(html,/<script>/);assert.match(html,/Detergent: Standard/);assert.match(html,/orders\/9017\/details/);
});
