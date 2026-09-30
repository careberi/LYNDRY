'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const page=require('../src/web/shop-intake-page');
const {createService,validIntake}=require('../src/core/partner-intake');
const {wireReturnWeight}=require('../src/web/shop-return-weight');
const ctx={shop:{id:'shop',name:'Test Laundry'},lang:'en',csrf:'test'};
const wash={number:9019,stage:'WASH',intakeComplete:true,weightCheckEnabled:true,returnCheckStatus:'PENDING',washLines:[['Water','Warm']]};
test('return weighing is absent until saved wash completion in both languages',()=>{
 for(const lang of ['en','es']){
  const before=page.detail({...ctx,lang,order:wash});
  assert.match(before,/action="[^"]+\/wash-complete"/);
  assert.doesNotMatch(before,/id="return_weight"|<button[^>]+data-return-submit|action="[^"]+\/ready"/);
  const after=page.detail({...ctx,lang,order:{...wash,washCompletedAt:'2026-09-29T12:00:00Z'}});
  assert.doesNotMatch(after,/action="[^"]+\/wash-complete"/);
  assert.match(after,/id="return_weight"/);
  assert.match(after,/<button[^>]+disabled data-return-submit/);
  assert.match(after,lang==='es'?/Lavado completo/:/Wash complete/);
 }
});
test('return button enables for valid input and disables when cleared or invalidated',()=>{
 const listeners={},button={disabled:false};
 const input={value:'',validity:{valid:true},form:{querySelector:()=>button},addEventListener:(name,fn)=>listeners[name]=fn};
 wireReturnWeight({getElementById:()=>input},validIntake);
 assert.equal(button.disabled,true);
 for(const value of ['0','-1','51','1e1','1.001','','NaN']){
  input.value=value;listeners.input();assert.equal(button.disabled,true,value);
 }
 for(const value of ['0.01','29','31','50']){
  input.value=value;listeners.input();assert.equal(button.disabled,false,value);
 }
 input.value='';listeners.change();assert.equal(button.disabled,true);
 input.value='30';input.validity.valid=false;listeners.input();assert.equal(button.disabled,true);
});
test('wash-complete calls the scoped saved action without payment or dispatch',async()=>{
 const calls=[];let dispatches=0,payments=0;
 const db={from(){const q={select(){return q;},or(){return q;},eq(){return q;},in(){return q;},maybeSingle(){return q;},then(resolve){return Promise.resolve({data:{id:'order',status:'AT_PARTNER'}}).then(resolve);}};return q;},
  rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,already:calls.length>1}};}};
 const service=createService({db,enrollReturn:async()=>{dispatches++;},settleWeight:async()=>{payments++;}});
 for(let n=0;n<2;n++)assert.equal((await service.act({partner:'shop',staff:{id:'staff',name:'Test'},number:9019,action:'wash-complete',weight:'30'})).notice,'wash-complete');
 assert.equal(dispatches,0);assert.equal(payments,0);
 assert.equal(calls[0].args.p_partner,'shop');assert.equal(calls[0].args.p_staff,'staff');assert.equal(calls[0].args.p_weight,null);
});
test('a premature ready rejection never reaches return dispatch',async()=>{
 let dispatches=0;
 const db={from(){const q={select(){return q;},or(){return q;},eq(){return q;},in(){return q;},maybeSingle(){return q;},then(resolve){return Promise.resolve({data:{id:'order',status:'AT_PARTNER'}}).then(resolve);}};return q;},
  rpc:async()=>({data:{ok:false,reason:'wash_complete_first'}})};
 const service=createService({db,enrollReturn:async()=>{dispatches++;}});
 assert.equal((await service.act({partner:'shop',staff:{id:'staff'},number:9019,action:'ready',weight:'30'})).reason,'wash_complete_first');
 assert.equal(dispatches,0);
});

test('intake enters washing; board separates the three operational stages',()=>{
 const queued={...wash,stage:'WASH',number:9101};
 const html=page.detail({...ctx,order:queued});
 assert.match(html,/action="[^"]+wash-complete"/);assert.doesNotMatch(html,/action="[^"]+wash-start"|id="return_weight"/);
 const board=page.board({...ctx,orders:[queued,{...wash,number:9102},{...wash,stage:'READY',number:9103}]});
 for(const name of ['Incoming deliveries','Washing','Outgoing deliveries'])assert.ok(board.includes(name));
 assert.doesNotMatch(board,/Leave by|Salir antes de|Ready to return/);
});
test('saved washing timestamps determine queue and never reveal intake weight',async()=>{
 let started=null,completed=null,ready=null;
 const db={from(table){const q={select(){return q;},or(){return q;},in(){return q;},eq(){return q;},order(){return q;},maybeSingle(){return q;},
 then(resolve){return Promise.resolve({data:table==='orders'?[{id:'order',order_number:9019,status:'AT_PARTNER'}]:table==='partner_order_intakes'?[{order_id:'order',received_at:'now',received_verified_at:'now',completed_at:'now',completed_by:'staff',weight_lb:31.27,wash_started_at:started,wash_completed_at:completed,ready_at:ready}]:table==='laundromat_workflow_settings'?{weight_tolerance_lb:1}:[]}).then(resolve);}};return q;}};
 const service=createService({db});
 assert.equal((await service.list('shop'))[0].stage,'WASH');
 started='2026-09-29T12:00:00Z';
 assert.equal((await service.list('shop'))[0].stage,'WASH');
 completed='2026-09-29T13:00:00Z';
 const view=(await service.list('shop'))[0];assert.equal(view.stage,'WASH');assert.equal(view.washCompletedAt,completed);assert.equal(view.weight,null);
 ready='2026-09-29T13:10:00Z';assert.equal((await service.list('shop'))[0].stage,'READY');
});

test('portal sidebar identifies only the signed-in laundromat and escapes its address',()=>{
 const shop={id:'shop',name:'Sample & Laundry',address_line1:'123 Test <Street>',address_line2:'Suite 2',city:'Paterson',state:'NJ',postal_code:'07514'};
 const html=page.board({...ctx,shop,orders:[]});
 const footer=html.match(/<div class="pos-sidebar-foot">([\s\S]*?)<\/div>/)[1];
 assert.match(footer,/Sample &amp; Laundry/);assert.match(footer,/123 Test &lt;Street&gt;, Suite 2, Paterson, NJ, 07514/);
 assert.doesNotMatch(footer,/LYNDRY Operations|Wash &amp; fold delivery/);
 const {posChrome}=require('../src/web/pos-layout');
 assert.match(posChrome({title:'Ops',mark:{href:'/'},nav:'',aside:''}),/LYNDRY Operations/);
});
