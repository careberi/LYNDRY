'use strict';

// ---------------------------------------------------------------------------
// A LAPTOP NEVER TEXTS A CUSTOMER, AND IT USED TO BE ONE BLANK FIELD AWAY.
//
// 25 September. The laptop's .env carried a real Telnyx API key against the
// PRODUCTION database. Texts stayed fake for one reason only: chooseDriver()
// needs BOTH keys, and TELNYX_PUBLIC_KEY happened to be an empty string.
//
// That is the worst shape a safety property can have, because the missing value
// is the one a developer adds ON PURPOSE. The public key verifies INBOUND
// webhook signatures - so anybody sitting down to test the /sms webhook
// properly would have filled it in, and the next status text, reminder or AI
// reply would have gone to a real phone from a half-finished branch.
//
// THE TWO HALVES ARE SEPARATED NOW. Verifying is safe and reaches nobody;
// sending is the dangerous half. Outside production real keys do the first and
// not the second.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const sms = require('../src/providers/sms');

const on = (configured, production) => sms.pick({ configured, production });

const SOURCE = () =>
  require('node:fs')
    .readFileSync(require('node:path').join(__dirname, '..', 'src', 'providers', 'sms', 'index.js'), 'utf8')
    .split('\r\n')
    .join('\n');

test('REAL KEYS ONLY SEND FROM PRODUCTION', () => {
  assert.equal(on(true, true), 'telnyx', 'production stopped sending texts');
  assert.equal(on(true, false), 'telnyx-grounded', 'a laptop with real keys would text customers');
});

test('and with no keys, nothing is invented in either direction', () => {
  // A public server with no credentials REFUSES rather than falling back to the
  // fake driver, which accepts unsigned webhooks - on the open internet that
  // lets anybody impersonate a customer.
  assert.equal(on(false, true), 'disabled');
  assert.equal(on(false, false), 'fake');
});

test('THE GROUNDED DRIVER CHECKS SIGNATURES FOR REAL AND REFUSES TO SEND', () => {
  // The whole point of the split, and the half that keeps it honest. If the
  // grounded driver took the FAKE verifySignature - which returns true for
  // anything - then testing the webhook path locally would prove nothing, and
  // the developer would put the real driver back to get a real answer. Which is
  // the accident this change exists to remove.
  const src = SOURCE();
  const body = src.slice(src.indexOf('const grounded = {'), src.indexOf('function pick('));

  assert.match(body, /verifySignature:\s*telnyx\.verifySignature/, 'grounded stopped verifying for real');
  assert.match(body, /parseInbound:\s*telnyx\.parseInbound/, 'grounded stopped parsing like Telnyx');
  assert.ok(!/sendMessage:\s*telnyx\.sendMessage/.test(body), 'grounded can send a real text');
  assert.match(body, /NOT SENT/, 'grounded sends without saying it did not');
});

test('nothing but Telnyx itself is treated as able to reach a phone', () => {
  // isFake is asked as "is it Telnyx", so a driver added later is assumed live
  // until it says otherwise. The wrong answer here is a text nobody expected.
  assert.match(SOURCE(), /isFake:\s*driver !== telnyx/, 'isFake went back to naming one driver');
});
