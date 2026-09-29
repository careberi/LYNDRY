'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function fixture(development = true) {
  let handler, middleware, write;
  const chain = { eq(){return this;}, select(){return this;}, maybeSingle:async()=>({data:{id:'customer'}}) };
  const modules = {
    '../db': {from(table){assert.equal(table,'customers');return {update(value){write=value;return chain;}};}},
    '../config': {config:{supabase:{isDevelopment:development}}},
    './spending-routes': {sameOrigin(){}}, '../web/layout': {escapeHtml:String},
  };
  const context = {require:n=>modules[n],module:{exports:{}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/customer-pricing'),'utf8'),context);
  const service=context.module.exports;
  service.registerAdmin({post(path,...handlers){middleware=handlers;handler=handlers.at(-1);}}, {guard(){},may(permission){assert.equal(permission,'service.manage');return ()=>{};}});
  return {service,chain,handler,middleware,write:()=>write};
}
test('wholesale switch represents saved state and offers the opposite value',()=>{
  const f=fixture();
  assert.match(f.service.control({id:'customer',pricing_category:'WHOLESALE'},true),/aria-checked="true"/);
  assert.match(f.service.control({id:'customer',pricing_category:'WHOLESALE'},true),/name="category" value="ONE_TIME"/);
  assert.match(f.service.control({id:'customer'},true),/name="category" value="WHOLESALE"/);
  assert.doesNotMatch(f.service.control({id:'customer',pricing_category:'WHOLESALE'},false),/<form/);
  assert.equal(fixture(false).service.control({id:'customer'},true),'');
});
test('toggle changes only customer category, rejects stale and malformed requests',async()=>{
  const f=fixture(), req={params:{id:'9d46f108-f0b2-46c9-a73a-bc9a91fdb6ef'},body:{category:'WHOLESALE',expected:'ONE_TIME'}};
  let url;
  const res={redirect(status,value){assert.equal(status,303);url=value;}};
  await f.handler(req,res);
  assert.equal(JSON.stringify(f.write()),'{"pricing_category":"WHOLESALE"}');
  assert.match(url,/\?note=/);
  f.chain.maybeSingle=async()=>({data:null});
  await f.handler(req,res);assert.match(decodeURIComponent(url),/setting changed/);
  req.body.category='ADMIN';await f.handler(req,res);assert.match(decodeURIComponent(url),/valid customer pricing/);
});
test('production rejects the mutation before the handler',()=>{
  let status;
  fixture(false).middleware[2]({}, {sendStatus:s=>{status=s;}},()=>assert.fail('production must not proceed'));
  assert.equal(status,404);
});
