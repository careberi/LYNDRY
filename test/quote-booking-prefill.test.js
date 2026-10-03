'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const handoff=require('../src/core/quote-booking-prefill');
test('quote address and unit survive login as editable temporary booking fields',()=>{
 let cookie;
 handoff.remember({cookie:(name,value,options)=>{cookie={name,value,options};}}, {street:'1 Test Street',unit:'Apt 4',town:'Lodi',zip:'07644'});
 assert.equal(cookie.options.httpOnly,true);assert.equal(cookie.options.path,'/account');
 assert.deepEqual(handoff.read({headers:{cookie:cookie.name+'='+cookie.value}}),{address_line1:'1 Test Street',address_line2:'Apt 4',city:'Lodi',postal_code:'07644'});
});
test('malformed expired or incomplete quote cookies cannot prefill a booking',()=>{
 for(const value of ['broken',Buffer.from(JSON.stringify({issuedAt:0,street:'1 Test',town:'Lodi',zip:'07644'})).toString('base64url')]) assert.equal(handoff.read({headers:{cookie:handoff.COOKIE_NAME+'='+value}}),null);
 assert.equal(handoff.read({headers:{}}),null);
});
