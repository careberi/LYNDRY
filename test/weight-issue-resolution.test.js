 'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createResolver,orderNumbers}=require('../src/core/weight-issue-resolution');
const issue={id:'issue',customer_id:'c',reason:'Order #9020: return weight mismatch. Review the laundromat return hold.',resolution:'Reviewed scales'};
const admin={id:'admin',role:'ADMIN',name:'Reviewer'};
function setup(extra={}) {
 const calls=[];
 const deps={loadOrders:async()=>[{id:'o',order_number:9020,partner_id:'p',status:'AT_PARTNER'}],readIntake:async()=>({partner_id:'p',return_check_status:'HELD'}),release:async()=>{calls.push('release');return {ok:true};},ready:async()=>{calls.push('ready');return {ok:true};},closeIssue:async()=>calls.push('close'),requestReturn:async()=>{calls.push('dispatch');return {ok:true};},...extra};
 return {calls,run:createResolver(deps)};
}
test('release and readiness precede closing issue and automatic dispatch',async()=>{
 const {calls,run}=setup();assert.equal((await run(issue,admin)).results[0].ok,true);assert.deepEqual(calls,['release','ready','close','dispatch']);
});
test('already resolved issues recover a stranded hold; already released holds skip release',async()=>{
 const {calls,run}=setup({readIntake:async()=>({partner_id:'p',return_check_status:'RELEASED'})});await run({...issue,status:'RESOLVED'},admin);assert.deepEqual(calls,['ready','close','dispatch']);
});
test('refused release or readiness never closes issue or dispatches',async()=>{
 for(const extra of [{release:async()=>({ok:false})},{ready:async()=>({ok:false,reason:'intake_first'})}]){
 const {calls,run}=setup(extra);await assert.rejects(run(issue,admin));assert.ok(!calls.includes('close'));assert.ok(!calls.includes('dispatch'));}
});
test('dispatch failure remains retryable and unrelated issues and nonadmins cannot release holds',async()=>{
 const {run}=setup({requestReturn:async()=>{throw Error('offline');}});const result=await run(issue,admin);assert.equal(result.results[0].ok,false);
 assert.equal((await run({...issue,reason:'Customer question'},admin)).handled,false);
 await assert.rejects(run(issue,{role:'DRIVER'}));
 assert.deepEqual(orderNumbers({...issue,reason:issue.reason+'\nOrder #9021: return weight mismatch. Review the laundromat return hold.'}),[9020,9021]);
});
test('customer/order mismatches cannot release a different order',async()=>{
 const {run,calls}=setup({loadOrders:async()=>[]});await assert.rejects(run(issue,admin));assert.deepEqual(calls,[]);
});
