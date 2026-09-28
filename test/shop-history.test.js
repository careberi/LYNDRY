'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createService}=require('../src/core/partner-intake');
const {board}=require('../src/web/shop-intake-page');
test('history reads confirmed collections for only the signed-in shop with stable bounded paging',async()=>{
 const calls=[];const rows=Array.from({length:11},(_,i)=>({orders:{order_number:9015-i,name:'PRIVATE'},weight_lb:30,collected_at:'2026-09-28T17:36:00Z',customer:{name:'PRIVATE'}}));
 const db={from(table){calls.push(['table',table]);const q={select(v){calls.push(['select',v]);return q;},eq(...a){calls.push(['eq',...a]);return q;},not(...a){calls.push(['not',...a]);return q;},order(...a){calls.push(['order',...a]);return q;},range(...a){calls.push(['range',...a]);return Promise.resolve({data:rows});}};return q;}};
 const service=createService({db});const result=await service.history('shop-A',2);
 assert.equal(result.page,2);assert.equal(result.hasNext,true);assert.equal(result.orders.length,10);
 assert.deepEqual(result.orders[0],{number:9015,weight:30,collectedAt:'2026-09-28T17:36:00Z'});
 assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['eq','partner_id','shop-A'])));
 assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['not','collected_at','is',null])));
 assert.deepEqual(calls.at(-1),['range',10,20]);assert.equal(calls.find(c=>c[0]==='select')[1],'weight_lb,collected_at,orders!inner(order_number)');
 for(const page of ['0','-1','bad','100000',['2','3']])assert.equal((await service.history('shop-A',page)).page,1);
});
test('completed history is separate from active queue counts, private fields, delivery claims and action forms',()=>{
 const ctx={lang:'en',shop:{name:'Cedar'},orders:[],history:{page:1,hasNext:true,orders:[{number:9015,weight:30,collectedAt:'2026-09-28T17:36:00Z',customer:'SECRET_CUSTOMER',price:9876}]}};
 const html=board(ctx),section=html.slice(html.indexOf('<section id="section-history"'));
 assert.match(section,/Completed orders/);assert.match(section,/#9015/);assert.match(section,/30 lb/);assert.match(section,/Sep 28, 2026/);assert.match(section,/1:36 PM/);
 assert.match(section,/history_page=2#section-history/);assert.doesNotMatch(section,/SECRET_CUSTOMER|9876|\/orders\/9015|\/intake|Delivered to customer/);
 assert.match(html,/Incoming deliveries/);assert.match(html,/Ready to wash/);assert.match(html,/Ready to return/);
 assert.match(board({...ctx,lang:'es'}),/Pedidos completados/);
 assert.match(board({...ctx,history:{page:1,hasNext:false,orders:[]}}),/No completed orders yet/);
});
