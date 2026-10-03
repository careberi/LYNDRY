
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const setup=require('../src/web/account-setup');
test('an account with no pickup or card has all three independent Update actions',()=>{
 const html=setup.summaryCards({id:'test',preferences:{}});
 assert.match(html,/Address/);assert.match(html,/Wash instructions/);assert.match(html,/Payment method/);assert.match(html,/No card on file/);
 assert.match(html,/href="\/account\/address"/);assert.match(html,/href="\/account\/wash"/);assert.match(html,/<form method="post" action="\/account\/card"/);
 assert.equal((html.match(/>Update</g)||[]).length,3);
});
test('saved card details retain the same direct Update action',()=>{
 const html=setup.summaryCards({card_brand:'Visa',card_last4:'4242',preferences:{}});assert.match(html,/Visa ending 4242/);assert.match(html,/action="\/account\/card"/);
});
