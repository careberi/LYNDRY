'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {registerPickupDispatch}=require('../src/routes/shipday-assignments');
function fixture({enabled=true,status='REQUESTED'}={}){
  let handlers;const calls=[];
  const database={from(){return {select(){return this;},eq(){return this;},single:async()=>({data:{id:'o',order_number:9017,status}})};}};
  const service={enabled,enqueue:async()=>({id:'p'}),run:async(...args)=>{calls.push(args);return {ok:true};}};
  const guard=(req,res,next)=>{req.opsUser={id:'admin'};next();};
  registerPickupDispatch({post(path,...args){assert.equal(path,'/ops/orders/:id/dispatch-pickup');handlers=args;}},{guard,may:permission=>{assert.equal(permission,'orders.override');return guard;}},service,database);
  return {calls,async request(driver='77',origin='http://pos.localhost:3000'){
    const req={params:{id:'9017'},body:{driver,replace:'yes'},protocol:'http',get:key=>key==='host'?'pos.localhost:3000':key==='origin'?origin:undefined};
    const res={status(code){this.code=code;return this;},send(){return this;},sendStatus(code){this.code=code;return this;},redirect(code,url){this.code=code;this.url=url;return this;}};
    for(const handler of handlers){let next=false;await handler(req,res,()=>{next=true;});if(!next)break;}return res;
  }};
}
test('pickup assignment requires same origin, override permission, eligible environment and pending order',async()=>{
  const f=fixture();assert.equal((await f.request('77','https://evil.example')).code,403);assert.equal(f.calls.length,0);
  for(const options of [{enabled:false},{status:'READY'}]){const g=fixture(options);assert.match((await g.request()).url,/problem=/);assert.equal(g.calls.length,0);}
});
test('pickup route forwards only a valid Shipday choice and staff identity',async()=>{
  const f=fixture();assert.match((await f.request('team-user-uuid')).url,/problem=/);assert.equal(f.calls.length,0);
  await f.request();assert.deepEqual(f.calls[0],['p',{mode:'IN_HOUSE',driverId:'77',acceptCancellationFee:true},'staff:admin']);
  await f.request('THIRD_PARTY');assert.equal(f.calls[1][1].mode,'THIRD_PARTY');
});
