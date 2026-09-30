'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {broadcastBody}=require('../src/web/prelaunch-page');
const {checkoutsBody}=require('../src/web/checkouts-page');
const {orderOverview}=require('../src/web/order-overview');
const {returnSummary}=require('../src/web/pickup-dispatch');
test('broadcast validation view retains escaped draft and selected audience',()=>{
 const html=broadcastBody({counts:{CUSTOMERS:3},recent:[],problem:'Confirm the audience',draft:'<script>draft</script>',audience:'CUSTOMERS'});
 assert.match(html,/value="CUSTOMERS" selected/);assert.ok(html.includes('&lt;script&gt;draft&lt;/script&gt;'));assert.match(html,/Confirm the audience/);
});
test('empty checkouts explain the state without an empty table',()=>{
 const html=checkoutsBody({intents:[]});assert.match(html,/No unfinished checkouts/);assert.doesNotMatch(html,/<table/);
});
test('actual paid amount is prominent and permission controlled',()=>{
 const args={order:{order_number:1,payment_status:'PAID',price_cents:4460},customer:{},canMoney:true};
 assert.match(orderOverview(args),/Paid: <strong>\$44.60/);
 assert.doesNotMatch(orderOverview({...args,canMoney:false}),/44.60/);
});
test('return dispatch never claims delivery to the laundromat and escapes problems',()=>{
 assert.match(returnSummary({state:'COMPLETED'}),/Delivery complete/);
 assert.doesNotMatch(returnSummary({state:'COMPLETED'}),/laundromat/);
 assert.match(returnSummary({state:'REVIEW',problem:'<bad>'}),/&lt;bad&gt;/);
 assert.equal(returnSummary(null),'Not scheduled');
});
