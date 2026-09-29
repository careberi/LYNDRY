'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { optOutControl } = require('../src/web/customer-texting');
test('text opt-out provides the required note without a script prompt', () => {
  const html = optOutControl({ id: 'customer', status: 'ACTIVE' }, true);
  assert.match(html, /name="note" maxlength="200" required/);
  assert.match(html, /Turn off text messages/);
  assert.doesNotMatch(html, /onsubmit|window.prompt|type="hidden"/);
});
test('opt-out cannot opt a customer back in or grant unauthorized controls', () => {
  const html = optOutControl({ id: 'customer', status: 'UNSUBSCRIBED' }, true);
  assert.match(html, /customer must text START/);
  assert.doesNotMatch(html, /<form|<button/);
  assert.equal(optOutControl({}, false), '');
});
