const test = require('node:test');
const assert = require('node:assert/strict');
const quote = require('../src/core/quote');
const result = require('../src/web/quote-result');
test('round-trip quote doubles each band without processing markup', () => {
  for (const [miles, cents] of [[0,1598],[5,1598],[5.1,1798],[6,1798],[6.1,1998],[7,1998],[7.1,2198],[10,2198]]) {
    assert.equal(quote.quoteFor({miles,partnerCentsPerLb:100}).deliveryFeeCents,cents);
  }
});
test('selected partner courier quote supplies both trips and is shown separately', () => {
  const q=quote.quoteFor({miles:3,partnerCentsPerLb:100,legCents:799});
  assert.equal(q.deliveryFeeCents,1598);
  const html=result.render({quote:q,address:'Test address'});
  assert.ok(html.includes('$15.98'));
  assert.ok(html.includes('Round trip'));
  assert.doesNotMatch(html,/Included|Smallest order|full machine/);
});
