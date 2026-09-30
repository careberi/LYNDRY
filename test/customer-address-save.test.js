'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../src/routes/account'),'utf8');
const fn=source.slice(source.indexOf('async function saveAddress('),source.indexOf('// The weekdays they ticked'));
function setup(result, throws=false){
 const writes=[];
 const save=vm.runInNewContext('('+fn+')', {config:{googleAddress:{enabled:true,serverKey:'test'}},require:(id)=>id.includes('google-address')?{validate:async()=>{if(throws)throw Error('offline');return result;}}:{enabled:false},booking:{zipInServiceArea:async()=>true,refreshBookedOrders:async()=>{}},db:{from:()=>({update:changes=>({eq:async()=>{writes.push(changes);return {};}})})}});
 return {save,writes};
}
const form={name:'Test',address_line1:'12 test st',address_line2:'Unit 4',city:'Test',postal_code:'07001',spot:'Front door'};
test('canonical address and unit are saved together with verified coordinates',async()=>{const {save,writes}=setup({street:'12 Test Street',town:'Test Town',zip:'07002',lat:40,lng:-74});const r=await save({id:'test'},form);assert.equal(r.ok,true);assert.equal(writes[0].address_line1,'12 Test Street');assert.equal(writes[0].address_line2,'Unit 4');assert.equal(writes[0].postal_code,'07002');assert.equal(writes[0].lat,40);});
test('invalid addresses and provider outages cannot write a customer',async()=>{for(const offline of [false,true]){const {save,writes}=setup(null,offline);assert.equal((await save({id:'test'},form)).ok,false);assert.equal(writes.length,0);}});
test('guest preflight validates without writing an account',async()=>{const {save,writes}=setup({street:'12 Test Street',town:'Test',zip:'07001',lat:40,lng:-74});assert.equal((await save({id:null},form)).ok,true);assert.equal(writes.length,0);});
