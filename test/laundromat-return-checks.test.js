'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const page=require('../src/web/shop-intake-page');
const {validReference,createService}=require('../src/core/partner-intake');
const {countdown}=require('../src/core/laundromat-countdown');
const {tolerance}=require('../src/routes/laundromat-checks');
const ctx={lang:'en',shop:{id:'shop',name:'Test Laundry'},csrf:'test'};
const wash={number:9019,stage:'WASH',intakeComplete:true,weight:31.27,shopReference:'INTERNAL-12',reference:'LYNDRY-9019-PICKUP',washLines:[['Water','Warm']],weightCheckEnabled:true,returnCheckStatus:'PENDING'};
test('wash board and detail contain no previous weight or handover card',()=>{
 for(const lang of ['en','es'])for(const html of [page.board({...ctx,lang,orders:[wash]}),page.detail({...ctx,lang,order:wash})]){
  assert.doesNotMatch(html,/31\.27|Match the handover|shop-handover/);
  assert.match(html,/INTERNAL-12/);
 }
 const detail=page.detail({...ctx,order:{...wash,stage:'WASH',washCompletedAt:'2026-09-29T12:00:00Z'}});
 assert.match(detail,/name="weight_lb"/);assert.doesNotMatch(detail,/value="31/);
});
test('only verified return weight is displayed on detail',()=>{
 const ready={...wash,stage:'READY',returnCheckStatus:'PASSED'};
 assert.match(page.detail({...ctx,order:ready}),/31\.27 lb/);
 assert.doesNotMatch(page.detail({...ctx,order:{...ready,returnCheckStatus:'PENDING'}}),/31\.27 lb/);
});
test('held order cannot show ready, request-driver or collection forms',()=>{
 const html=page.detail({...ctx,order:{...wash,stage:'READY',returnCheckStatus:'HELD',canCollect:true,returnNeedsRequest:true}});
 assert.match(html,/Return is on hold/);
 assert.doesNotMatch(html,/action="[^"]+\/(ready|collect|request-return)"/);
});
test('optional reference appears at intake, escapes markup, and never replaces order number',()=>{
 const incoming={...wash,stage:'INCOMING',canAccept:true,shopReference:'<script>test</script>'};
 const html=page.detail({...ctx,order:incoming});
 assert.match(html,/name="shop_reference"/);assert.match(html,/LYNDRY #9019/);
 assert.match(html,/&lt;script&gt;test/);assert.match(html,/shop-handover/);
 assert.equal(validReference(''),true);assert.equal(validReference('A #12/4'),true);
 assert.equal(validReference('x'.repeat(65)),false);assert.equal(validReference('x\ny'),false);
});
test('countdown has no color gaps, zero becomes overdue, and invalid deadlines stay unknown',()=>{
 const now=Date.parse('2026-09-29T12:00:00Z'),due=m=>new Date(now+m*60000).toISOString();
 assert.equal(countdown(due(601),now).tone,'green');
 for(const n of [600,300,180,121])assert.equal(countdown(due(n),now).tone,'yellow');
 for(const n of [120,60,0,-5])assert.equal(countdown(due(n),now).tone,'red');
 assert.equal(countdown(due(-1),now).text,'Overdue');
 assert.equal(countdown('bad',now).tone,'unknown');
 assert.equal(countdown(due(-1),now,'es').text,'Vencido');
});
test('weight tolerance stays unconfigured for blank and rejects unsafe values',()=>{
 assert.equal(tolerance(''),null);assert.equal(tolerance('0'),0);assert.equal(tolerance('0.50'),0.5);
 for(const value of ['-1','11','0.001','1e1','NaN','Infinity'])assert.throws(()=>tolerance(value));
});
test('service response redacts intake weight while retaining structured wash access',async()=>{
 const order={id:'order',order_number:9019,status:'AT_PARTNER'};
 const intake={order_id:'order',received_at:'now',received_verified_at:'now',completed_at:'now',completed_by:'staff',weight_lb:31.27,shop_reference:'R-12',return_check_status:'PENDING'};
 const db={from(table){const q={select(){return q;},or(){return q;},in(){return q;},eq(){return q;},order(){return q;},maybeSingle(){return q;},
  then(resolve){return Promise.resolve({data:table==='orders'?[order]:table==='partner_order_intakes'?[intake]:table==='laundromat_workflow_settings'?{weight_tolerance_lb:0.5}:[],error:null}).then(resolve);}};return q;}};
 const [view]=await createService({db}).list('shop');
 assert.equal(view.weight,null);assert.equal(view.intakeComplete,true);assert.equal(view.shopReference,'R-12');assert.equal(view.weightCheckEnabled,true);
 assert.doesNotMatch(JSON.stringify(view),/31\.27/);
});
test('intake forwards only optional reference and measured weight, never submitted identities',async()=>{
 const calls=[];
 const db={from(table){const q={select(){return q;},or(){return q;},eq(){return q;},in(){return q;},maybeSingle(){return q;},
  then(resolve){return Promise.resolve({data:{id:'order',status:'AT_PARTNER'},error:null}).then(resolve);}};return q;},
  rpc:async(name,args)=>{calls.push(args);return {data:{ok:true,already:true}};}};
 const service=createService({db,checkDelivery:async()=>({ok:true})});
 await service.act({partner:'shop',staff:{id:'staff'},number:'9019',action:'intake',weight:'32',shopReference:' SHOP-5 '});
 assert.equal(calls[0].p_tracking,'SHOP-5');assert.equal(calls[0].p_weight,32);
 const bad=await service.act({partner:'shop',staff:{id:'staff'},number:'9019',action:'intake',weight:'32',shopReference:'x'.repeat(65)});
 assert.equal(bad.ok,false);assert.equal(calls.length,1);
});


test('held board and detail explain the mismatch and suppress normal actions in both languages',()=>{
 const held={...wash,washCompletedAt:'now',returnCheckStatus:'HELD',heldIntakeWeight:33,heldReturnWeight:25,officeReview:true};
 for(const lang of ['en','es']) {
  const board=page.board({...ctx,lang,orders:[held]});
  const detail=page.detail({...ctx,lang,order:held});
  for(const html of [board,detail]) {
   assert.match(html,/shop-weight-hold/);assert.match(html,/33 lb/);assert.match(html,/25 lb/);
   assert.match(html,lang==='en'?/Weights don.t match/:/Los pesos no coinciden/);
  }
  assert.doesNotMatch(board,/Weigh for return|Pesar para devolver/);
  assert.doesNotMatch(detail,/action="[^"]+\/(ready|collect|request-return)"/);
 }
 const cleared=page.board({...ctx,orders:[{...held,returnCheckStatus:'RELEASED',officeReview:false}]});
 assert.doesNotMatch(cleared,/Weights don.t match/);
});
