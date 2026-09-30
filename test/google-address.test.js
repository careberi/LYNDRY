'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {accepted,validate}=require('../src/core/google-address');
function valid(){return {verdict:{addressComplete:true,validationGranularity:'PREMISE'},address:{postalAddress:{regionCode:'US',administrativeArea:'NJ',locality:'Test Town',postalCode:'07001'},addressComponents:[{componentType:'street_number',componentName:{text:'12'}},{componentType:'route',componentName:{text:'Example Street'}}]},geocode:{location:{latitude:40.8,longitude:-74}}};}
test('uses validated components and coordinates',()=>{assert.deepEqual(accepted(valid()),{street:'12 Example Street',town:'Test Town',zip:'07001',lat:40.8,lng:-74});});
for(const flag of ['hasUnconfirmedComponents','hasReplacedComponents'])test('rejects '+flag,()=>{const r=valid();r.verdict[flag]=true;assert.equal(accepted(r),null);});
test('rejects approximate, incomplete and non NJ results',()=>{
 for(const change of [r=>r.verdict.validationGranularity='ROUTE',r=>r.verdict.addressComplete=false,r=>r.address.postalAddress.administrativeArea='NY',r=>r.address.unresolvedTokens=['nonsense'],r=>r.address.missingComponentTypes=['subpremise'],r=>r.geocode.location.latitude=null]) {const r=valid();change(r);assert.equal(accepted(r),null);}
});
test('keeps secret in request header and validates submitted text',async()=>{
 let request;const result=await validate('12 Example Street',{key:'test-secret',fetchImpl:async(url,options)=>{request={url,...options};return {ok:true,json:async()=>({result:valid()})};}});
 assert.equal(result.zip,'07001');assert.ok(!request.url.includes('test-secret'));assert.equal(request.headers['X-Goog-Api-Key'],'test-secret');assert.deepEqual(JSON.parse(request.body).address.addressLines,['12 Example Street']);
});
test('missing key and provider outage fail closed',async()=>{
 await assert.rejects(validate('x',{key:''}),/not configured/);
 await assert.rejects(validate('x',{key:'test',fetchImpl:async()=>({ok:false})}),/unavailable/);
});
test('widget off unless enabled and never embeds server key',()=>{
 const {script}=require('../src/web/google-address');assert.equal(script({enabled:false}),'');
 const html=script({enabled:true,browserKey:'public',serverKey:'secret'});assert.ok(html.includes('gmp-select'));assert.ok(!html.includes('secret'));
});
