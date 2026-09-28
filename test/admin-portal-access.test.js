'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createRouter}=require('../src/routes/shop-admin-portal');
const {token}=require('../src/routes/shop-intake-routes');
const {posHost}=require('../src/web/pos-host');
const {complete,createService}=require('../src/core/partner-intake');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const admin={id:'admin-id',name:'Neil',role:'ADMIN',status:'ACTIVE',session_token:'test-session'};
test('admin portal keeps two shop tabs scoped, rewrites navigation and records the real actor',async t=>{
  let user=admin;const calls=[];
  const service={list:async shop=>{calls.push({list:shop});return [];},detail:async()=>null,act:async args=>{calls.push(args);return {ok:true,notice:'accept'};}};
  const app=express();app.use(posHost({host:'127.0.0.1'}));app.use(express.urlencoded({extended:false}));
  app.use((req,res,next)=>{req.opsUser=user;next();});
  app.use('/ops/partners/:partnerId/portal',createRouter({service,staffService:{list:async()=>[],addAttendant:async args=>{calls.push(args);return {ok:true};},setStatus:async(id,status,args)=>{calls.push({id,status,...args});return {ok:false,reason:'not_theirs'};}},loadPartner:async id=>[A,B].includes(id)?{id,name:'Shop '+id,type:'LAUNDROMAT',status:'ACTIVE'}:null}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  for(const id of [A,B]){
    const response=await fetch(base+'/partners/'+id+'/portal');assert.equal(response.status,200);
    const html=await response.text();assert.match(html,/Administrator access/);assert.match(html,/Neil/);
    assert.ok(html.includes('action="/partners/'+id+'/portal"'));
    assert.ok(html.includes('href="/partners/'+id+'/portal/staff'));
    assert.ok(html.includes('action="/partners/'+id+'/portal/logout"'));assert.doesNotMatch(html,/Back to laundromat/);assert.doesNotMatch(html,/action="\/shop/);
  }
  assert.deepEqual(calls.map(c=>c.list),[A,B]);
  const post=body=>fetch(base+'/partners/'+A+'/portal/orders/9015/accept',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),redirect:'manual'});
  assert.equal((await post({csrf:'bad'})).status,403);
  const result=await post({csrf:token(admin),partner_id:B,isOpsAdmin:'false',staff:'somebody-else'});
  assert.equal(result.status,303);assert.match(result.headers.get('location'),new RegExp('/partners/'+A+'/portal/orders/9015'));
  assert.equal(calls.at(-1).partner,A);assert.equal(calls.at(-1).staff.id,admin.id);assert.equal(calls.at(-1).staff.isOpsAdmin,true);
  assert.equal((await fetch(base+'/partners/'+A+'/portal/orders/9999')).status,404);
  assert.equal((await fetch(base+'/partners/not-a-uuid/portal')).status,404);
  const staffBase=base+'/partners/'+A+'/portal/staff';
  const staffPage=await fetch(staffBase,{redirect:'manual'});
  assert.equal(staffPage.status,200);
  const staffHtml=await staffPage.text();
  assert.ok(staffHtml.includes('name="csrf"'));
  for(const match of staffHtml.matchAll(/(?:href|action)="([^"]+)"/g)){
    const url=match[1];
    if(url.startsWith('/partners/'))assert.ok(url.startsWith('/partners/'+A+'/portal'));
    assert.ok(!['/admin','/customers','/partners','/team'].includes(url));
  }
  const staffPost=(suffix,body)=>fetch(staffBase+suffix,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),redirect:'manual'});
  assert.equal((await staffPost('',{name:'Attendant'})).status,403);
  const added=await staffPost('',{csrf:token(admin),name:'Attendant',phone:'2015550123',partnerId:B,role:'OWNER'});
  assert.equal(added.status,303);assert.match(added.headers.get('location'),/portal\/staff\?lang=en&done=added/);
  assert.deepEqual(calls.at(-1),{partnerId:A,name:'Attendant',phone:'2015550123'});
  const changed=await staffPost('/other-shop-staff',{csrf:token(admin),status:'DISABLED',partnerId:B});
  assert.match(changed.headers.get('location'),/portal\/staff\?lang=en&problem=notyours/);
  assert.equal(calls.at(-1).partnerId,A);
  const loggedOut=await fetch(base+'/partners/'+A+'/portal/logout',{method:'POST',redirect:'manual'});
  assert.equal(loggedOut.status,303);assert.match(loggedOut.headers.get('location'),/\/shop\/login$/);

  for(const denied of [null,{...admin,role:'DRIVER'},{...admin,role:'SALES'},{...admin,isMachine:true},{...admin,status:'DISABLED'}]){
    user=denied;assert.equal((await fetch(base+'/partners/'+A+'/portal')).status,403);
  }
});
test('admin-completed intake unlocks instructions and selects the audited admin RPC only for server actor',async()=>{
  assert.equal(complete({received_at:'now',received_verified_at:'now',completed_at:'now',completed_by_admin:'admin',tracking_number:'T-1',weight_lb:25}),true);
  const calls=[];
  const db={rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,already:true}};},from(){const q={select(){return q;},or(){return q;},eq(){return q;},in(){return q;},maybeSingle:async()=>({data:{id:'order'}})};return q;}};
  const service=createService({db,checkDelivery:async()=>({ok:true})});
  for(const isOpsAdmin of [false,true])await service.act({partner:A,staff:{...admin,isOpsAdmin},number:'9015',action:'intake',weight:'33'});
  assert.equal(calls[0].name,'record_partner_intake');assert.equal(calls[0].args.p_staff,admin.id);
  assert.equal(calls[1].name,'record_partner_intake_admin');assert.equal(calls[1].args.p_admin,admin.id);
  assert.equal(calls[1].args.p_staff,undefined);
});
