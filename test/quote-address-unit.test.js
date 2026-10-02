'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('pricing validates the building and preserves the unit for pickup details', async () => {
  const source = fs.readFileSync(require.resolve('../src/routes/web'), 'utf8');
  const route = source.slice(source.indexOf("router.get('/quote',"), source.indexOf('// A SERVICE-AREA REQUEST'));
  let handler, lookup, customer, rendered;
  const place = {street:'12 Example Street',town:'Test Town',zip:'07001',lat:40.8,lng:-74};
  const checkout = {enabled:true,previewQuote:async c => {customer=c;return {};}};
  vm.runInNewContext(route, {
    router:{get:(_path,fn)=>{handler=fn;}},
    config:{courier:{model:'DYNAMIC'},googleAddress:{enabled:true,serverKey:'test'},pricing:{minimumCents:0}},
    require:name=> name.includes('weight-based-pricing') ? require('../src/core/weight-based-pricing') : name.includes('dev-checkout') ? checkout : name.includes('google-address') ? {validate:async address=>{lookup=address;return place;}} : {isSignedIn:()=>false},
    throttle:{hit:()=>false},renderPage:x=>x,readPageBody:()=>'',site:{name:'Test'},money:()=>'',
    quoteResult:{render:x=>{rendered=x;return '';}}
  });
  for (const unit of ['apt 2', 'Suite 4', '']) {
    await handler({query:{street:'12 Example Street',town:'Test Town',zip:'07001',state:'NJ',unit},ip:'test'}, {type(){return this;},send(){}});
    assert.equal(lookup,'12 Example Street, Test Town, NJ, 07001');
    assert.equal(customer.address_line1,'12 Example Street');
    assert.equal(customer.address_line2,unit);
    assert.equal(rendered.address,'12 Example Street, Test Town, NJ, 07001');
    assert.equal(rendered.fields.unit,unit);
  }
});
