'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {returnDispatchCard,registerReturnDispatch}=require('../src/routes/shipday-assignments');

test('ready orders offer third-party and active in-house return dispatch',()=>{
  const html=returnDispatchCard({
    order:{order_number:9006,status:'READY'},
    plan:null,
    drivers:[
      {id:'active',name:'Active Driver',isActive:true,isOnShift:true},
      {id:'offline',name:'Offline Driver',isActive:true,isOnShift:false},
    ],
    simulation:true,
  });
  assert.match(html,/Dispatch third-party driver/);
  assert.match(html,/Dispatch in-house driver/);
  assert.match(html,/Active Driver/);
  assert.doesNotMatch(html,/Offline Driver/);
  assert.match(html,/no real driver is requested/i);
});

test('return dispatch is hidden before ready and locked after assignment',()=>{
  assert.equal(returnDispatchCard({order:{status:'AT_PARTNER'},simulation:true}),'');
  const html=returnDispatchCard({order:{order_number:9006,status:'READY'},plan:{state:'ASSIGNED',assigned_name:'Dan Reyes'},simulation:true});
  assert.match(html,/Driver assigned/);
  assert.match(html,/Dan Reyes/);
  assert.doesNotMatch(html,/<form/);
});

test('live return dispatch remains disabled until Shipday activation',()=>{
  const html=returnDispatchCard({order:{order_number:9006,status:'READY'},simulation:false});
  assert.match(html,/Live dispatch is disabled/);
  assert.doesNotMatch(html,/<form/);
});

async function fixture(order,{drivers=[],plan={id:'plan-1',state:'PLANNED'},runResult={ok:true}}={}){
  const calls={enroll:[],run:[]};
  const database={from(){return {select(){return this;},eq(){return this;},maybeSingle(){return Promise.resolve(order);}};}};
  const service={
    result:async query=>await query,
    provider:{drivers:async()=>drivers},
    enroll:async(...args)=>{calls.enroll.push(args);return [plan];},
    run:async(...args)=>{calls.run.push(args);return runResult;},
  };
  const routes=[];
  const router={post(path,...handlers){routes.push({path,handlers});}};
  const guard=(req,res,next)=>{req.opsUser={id:'admin'};next();};
  const may=permission=>(req,res,next)=>{assert.equal(permission,'orders.override');next();};
  registerReturnDispatch(router,{guard,may},service,database);
  const route=routes[0];
  async function request({mode='THIRD_PARTY',driver_id,origin='http://pos.localhost:3000'}={}){
    const req={params:{id:String(order.order_number)},body:{mode,driver_id},protocol:'http',get:name=>name==='host'?'pos.localhost:3000':name==='origin'?origin:undefined};
    const response={statusCode:null,location:null,status(code){this.statusCode=code;return this;},send(){return this;},sendStatus(code){this.statusCode=code;return this;},redirect(code,location){this.statusCode=code;this.location=location;return this;}};
    for(let index=0;index<route.handlers.length-1;index++){
      let continued=false;
      route.handlers[index](req,response,error=>{if(error)throw error;continued=true;});
      if(!continued||response.statusCode)return response;
    }
    await route.handlers.at(-1)(req,response,()=>{});
    return response;
  }
  return {request,calls};
}

test('ready paid order dispatches its return through the existing assignment runtime',async()=>{
  const order={id:'order-1',order_number:9006,status:'READY',payment_status:'PAID'};
  const f=await fixture(order);
  const response=await f.request();
  assert.equal(response.statusCode,303);
  assert.match(response.location,/Third-party%20driver%20dispatched/);
  assert.deepEqual(f.calls.enroll,[[order,'TO_CUSTOMER']]);
  assert.deepEqual(f.calls.run,[['plan-1',{mode:'THIRD_PARTY',driverId:null},'staff:admin']]);
});

test('return dispatch rejects unsafe status, payment, origin and in-house driver choices',async()=>{
  for(const order of [
    {id:'order-1',order_number:9006,status:'AT_PARTNER',payment_status:'PAID'},
    {id:'order-1',order_number:9006,status:'READY',payment_status:'DUE'},
  ]){
    const f=await fixture(order);const response=await f.request();
    assert.equal(response.statusCode,303);assert.equal(f.calls.run.length,0);
  }
  const order={id:'order-1',order_number:9006,status:'READY',payment_status:'WAIVED'};
  const f=await fixture(order,{drivers:[{id:'offline',isActive:true,isOnShift:false}]});
  const response=await f.request({mode:'IN_HOUSE',driver_id:'offline'});
  assert.equal(response.statusCode,303);assert.equal(f.calls.enroll.length,0);assert.equal(f.calls.run.length,0);
  const cross=await f.request({origin:'https://evil.example'});
  assert.equal(cross.statusCode,403);assert.equal(f.calls.run.length,0);
});
