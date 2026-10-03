'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {cancelLinked}=require('../src/core/shipday-cancellation');
function fixture(){let rows=[{orderId:123,orderNumber:'REF',orderStatus:{orderState:'NOT_ACCEPTED'}}],writes=0;return {get writes(){return writes;},set rows(v){rows=v;},args:{plan:{shipday_order_id:'123',external_reference:'REF',mode:'IN_HOUSE'},assertCanceled:async()=>{},provider:{findOrders:async()=>rows,removeOrder:async()=>{writes++;rows=[];}}}};}
test('canceled scheduled job is removed by exact ID and verified; retry does not repeat removal',async()=>{const f=fixture();await cancelLinked(f.args);await cancelLinked(f.args);assert.equal(f.writes,1);});
test('lookup failure never deletes a job or reports absence',async()=>{const f=fixture();f.args.provider.findOrders=async()=>{throw Error('429');};await assert.rejects(cancelLinked(f.args));assert.equal(f.writes,0);});
for(const remote of [{orderId:999,orderNumber:'REF'},{orderId:123,orderNumber:'REF',orderStatus:{orderState:'STARTED'}},{orderId:123,orderNumber:'REF',thirdPartyAssignedAnytime:true,orderStatus:{orderState:'NOT_ACCEPTED'}}])test('mismatch, started or third party job requires review '+JSON.stringify(remote),async()=>{const f=fixture();f.rows=[remote];await assert.rejects(cancelLinked(f.args));assert.equal(f.writes,0);});
test('reinstated order cannot remove its delivery',async()=>{const f=fixture();f.args.assertCanceled=async()=>{throw Error('reinstated');};await assert.rejects(cancelLinked(f.args));assert.equal(f.writes,0);});
test('unconfirmed removal stays an error',async()=>{const f=fixture();f.args.provider.removeOrder=async()=>({ok:true});await assert.rejects(cancelLinked(f.args),/not been confirmed/);});
