'use strict';

// ---------------------------------------------------------------------------
// SCANNING WITH THE PHONE'S OWN CAMERA.
//
// Neil, 12 September: the in-page scanner "doesn't read the code". His fix is
// the one the laundromat has always used - point the real camera at the QR,
// which opens /o/<code>, and take the code out of the URL.
//
// The whole of that lands on one function, and the half of it worth pinning is
// the refusals. /o/<code> is a page with no login at all, reachable by anybody
// who can point a camera, and a redirect it can be talked into is an open
// redirector on lyndry.com - a ready-made phishing link.
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { scanReturn, CRUMB } = require('../src/web/scanner');

test('it hands the code back to the screen the driver came from', () => {
  assert.equal(scanReturn('/ops/run', '7MQ5Y2'), '/ops/run?code=7MQ5Y2');
  assert.equal(scanReturn('/ops/loadout', 'K3F9QP'), '/ops/loadout?code=K3F9QP');
});

test('it keeps whatever else was on that screen', () => {
  // /ops/run?bag=2 is a particular bag of a particular stop. Losing it would
  // drop him back on the list he had already tapped into.
  assert.equal(scanReturn('/ops/run?bag=2', '7MQ5Y2'), '/ops/run?bag=2&code=7MQ5Y2');
});

test('last scan does not stack up on this one', () => {
  assert.equal(scanReturn('/ops/run?bag=2&code=OLD123', '7MQ5Y2'), '/ops/run?bag=2&code=7MQ5Y2');
});

// --- The refusals -----------------------------------------------------------

test('only /ops, because that is the only place a driver was', () => {
  assert.equal(scanReturn('/account', '7MQ5Y2'), null);
  assert.equal(scanReturn('/', '7MQ5Y2'), null);
  assert.equal(scanReturn('/opsy', '7MQ5Y2'), null);
  assert.equal(scanReturn('/pay/abc', '7MQ5Y2'), null);
});

test('it cannot be talked into leaving the site', () => {
  // Each of these would make a public page with no login into an open
  // redirector on our own domain.
  assert.equal(scanReturn('//evil.example/x', '7MQ5Y2'), null);
  assert.equal(scanReturn('https://evil.example/ops/run', '7MQ5Y2'), null);
  // A backslash is the one that matters: some browsers read it as a slash,
  // so /ops + backslash + host can escape the site. Built from its character
  // code because a literal backslash does not survive every editor on the way
  // into this file.
  const slash = String.fromCharCode(92);
  assert.equal(scanReturn('/ops/' + slash + slash + 'evil.example', '7MQ5Y2'), null);
  assert.equal(scanReturn('javascript:alert(1)', '7MQ5Y2'), null);
});

test('a code that is not code-shaped goes nowhere', () => {
  assert.equal(scanReturn('/ops/run', 'not a code!'), null);
  assert.equal(scanReturn('/ops/run', '../../etc/passwd'), null);
  assert.equal(scanReturn('/ops/run', ''), null);
  assert.equal(scanReturn('/ops/run', 'A'.repeat(20)), null);
});

test('no crumb, no redirect - the laundromat sees its own page', () => {
  // Everybody who is not a driver mid-scan has no crumb, and /o/<code> has to
  // go on being the page a laundromat attendant reads.
  assert.equal(scanReturn(null, '7MQ5Y2'), null);
  assert.equal(scanReturn('', '7MQ5Y2'), null);
  assert.equal(scanReturn(undefined, '7MQ5Y2'), null);
});

test('a sticker code with its sequence still works', () => {
  // Bag stickers are 7MQ5Y2-1 upwards off one tag.
  assert.equal(scanReturn('/ops/run', '7MQ5Y2-1'), '/ops/run?code=7MQ5Y2-1');
});

test('the crumb has a name and it is not a credential', () => {
  assert.equal(CRUMB, 'ly_scan');
});
