'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/core/actions'), 'utf8');
const redirect = source.slice(source.indexOf('function orderOnlineInstead()'), source.indexOf('async function run('));
const run = source.slice(source.indexOf('async function run('), source.indexOf('module.exports ='));
for (const action of ['create_order', 'check_slot', 'set_pickup_schedule']) {
  test('development refuses ' + action + ' and returns the booking link without executing it', async () => {
    const context = { config: {supabase:{isProduction:false},baseUrl:'http://localhost:3002/'}, console:{warn(){}}, require: () => ({CANNOT_BOOK:['create_order','check_slot','set_pickup_schedule']}) };
    vm.createContext(context);
    vm.runInContext(redirect + run, context);
    assert.equal(await context.run(action, {}, {}), 'You can place your order online here: http://localhost:3002/account/book. Sign in with this phone number to get started.');
  });
}
test('production keeps its existing redirect wording', () => {
  const context = {config:{supabase:{isProduction:true}},site:{domain:'lyndry.com'}};
  vm.createContext(context); vm.runInContext(redirect, context);
  assert.match(context.orderOnlineInstead(), /place it at lyndry.com\/account /);
});
