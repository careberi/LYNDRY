'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const holds = require('../src/core/card-hold-policy');
function loadBilling(isDevelopment) {
  const filename = require('node:path').join(__dirname,'../src/core/billing.js');
  const localRequire = require('node:module').createRequire(filename);
  const { config } = localRequire('../config');
  const module = { exports: {} };
  require('node:vm').runInThisContext('(function(require,module){'+require('node:fs').readFileSync(filename,'utf8')+'\n})')(
    name => name === '../config' ? {config:{...config,supabase:{...config.supabase,isDevelopment}}} : localRequire(name),module);
  return module.exports;
}
const { updatedPolicy } = require('../src/routes/pricing-settings');
const { review } = require('../src/web/booking-price');
const policy = {marginBps:{ONE_TIME:2000,SUBSCRIPTION:1000,WHOLESALE:500},processingBps:290,processingFixedCents:30,operationalFeeBps:2500,referenceWeightLb:33};
const snapshot = {rateCentsPerLb:137,operationalFeeCents:350,minimumTotalCents:1943};
test('fixed, minimum and maximum holds use the saved quote, fee included once', () => {
  assert.equal(holds.amount(snapshot,{mode:'FIXED',fixedCents:3000}),3000);
  assert.equal(holds.amount(snapshot,{mode:'MINIMUM'}),1943);
  assert.equal(holds.amount(snapshot,{mode:'MAXIMUM'}),7200);
  assert.equal(holds.amount({...snapshot,minimumTotalCents:8000},{mode:'MAXIMUM'}),8000);
  assert.throws(()=>holds.amount({}, {mode:'MINIMUM'}));
  assert.throws(()=>holds.amount({}, {mode:'MAXIMUM'}));
});
test('policy saves reject invalid money and percentages and preserve the prior policy', () => {
  const form={ONE_TIME:'21.25',SUBSCRIPTION:'10',WHOLESALE:'5',hold_mode:'FIXED',hold_fixed:'35.50'};
  const saved=updatedPolicy(policy,form,'admin');
  assert.equal(saved.marginBps.ONE_TIME,2125);
  assert.deepEqual(saved.cardHold,{mode:'FIXED',fixedCents:3550});
  assert.equal(policy.marginBps.ONE_TIME,2000);
  for(const bad of [{hold_fixed:'0'},{hold_fixed:'12.999'},{hold_mode:'other'},{ONE_TIME:''},{ONE_TIME:'99'}]) assert.throws(()=>updatedPolicy(policy,{...form,...bad},'admin'));
});
test('billing uses configured holds only for development quoted orders and preserves existing holds', async () => {
    const billing=loadBilling(true);
    const order={id:'o',dev_quote_id:'q',pricing_snapshot:{...snapshot,policy:{...policy,cardHold:{mode:'MAXIMUM'}}}};
    assert.equal(billing.holdFor(order),7200);
    const held=await billing.authorizeShowUp({...order,authorization_intent_id:'existing',authorized_cents:2500},{});
    assert.equal(held.alreadyHeld,true);
    assert.equal(billing.holdFor({...order,dev_quote_id:null}),require('../src/core/quote').holdCents());
    assert.equal(loadBilling(false).holdFor(order),require('../src/core/quote').holdCents());
});
test('booking review discloses the exact dynamic hold before confirmation', () => {
  const html=review({snapshot:{...snapshot,policy:{cardHold:{mode:'MAXIMUM'}}}},'');
  assert.match(html,/Temporary card hold: \$72.00/);
  assert.match(html,/authorize the temporary card hold/);
});
test('development card consent describes quoted holds and unused release', () => {
  const text=loadBilling(true).consentText();assert.match(text,/temporary card hold/);assert.match(text,/unused amount is released/);assert.ok(text.length<=1200);
});
