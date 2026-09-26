'use strict';

// ---------------------------------------------------------------------------
// THE TRIP INTO THE LAUNDROMAT, AND THE CODE THAT COMES WITH IT.
//
// Neil: "Uber's PIN. It belongs on the trip into the laundromat, so an attendant
// can prove the bags at her counter are the ones that left a doorstep."
//
// A PIN ON THIS LEG AND NOT ON THE RETURN, and the asymmetry is the whole point.
// Uber generates a four-digit code, returns it to us, AND TEXTS IT TO THE
// RECIPIENT - so the laundromat holds it and the courier has to ask before the
// app will let them complete the drop. A courier who turns up at the wrong shop
// cannot offload there, because only the right shop's screen shows the right
// number. The return leg is left at a door, where there is nobody to read a code
// out, and Uber refuses the combination outright.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fake = require('../src/providers/couriers/fake');
const page = require('../src/web/shop-page');

const SRC = (...bits) => fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8');

// THE CODE, WITHOUT THE PROSE.
//
// An assertion about what a function DOES must not be able to read the comment
// explaining it. This file's own `.ok` check failed on the note describing the
// bug it exists for, which is the test marking its own homework backwards: the
// fix was in place and the explanation of the fix is what tripped it.
function code(body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('THE LEG INTO THE LAUNDROMAT ASKS FOR A PIN, THE ONE OUT DOES NOT', () => {
  const src = SRC('core', 'courier-legs.js');

  const inbound = /async function sendForPickup\([\s\S]*?\n}/.exec(src);
  const outbound = /async function sendForReturn\([\s\S]*?\n}/.exec(src);

  assert.ok(inbound, 'sendForPickup has been renamed or removed');
  assert.ok(outbound, 'sendForReturn has been renamed or removed');

  assert.match(inbound[0], /requirePin:\s*true/, 'the trip into the laundromat stopped asking for a code');
  assert.match(inbound[0], /leaveAtDoor:\s*false/, 'a laundromat drop is being left at a door');

  assert.match(outbound[0], /leaveAtDoor:\s*true/, 'the trip back stopped being left at the door');
  assert.match(outbound[0], /requirePin:\s*false/, 'a PIN is being asked for on a leave-at-door delivery');
});

test('AND UBER REFUSES THE COMBINATION, WHICH IS WHY', async () => {
  // Proved against the pretend courier, which is strict about exactly what the
  // real one is strict about - that is the whole reason it exists.
  await assert.rejects(
    fake.book({ from: { line1: 'a' }, to: { line1: 'b' }, requirePin: true, leaveAtDoor: true }),
    /PIN cannot be required on a delivery left at the door/
  );
});

test('a PIN-verified booking carries a four-digit code back', async () => {
  const delivery = await fake.book({
    from: { line1: '16-50 Chandler Dr' },
    to: { line1: '148 Main St' },
    requirePin: true,
    leaveAtDoor: false,
  });

  assert.match(delivery.pin, /^\d{4}$/, 'no four-digit code came back for the laundromat');
});

test('THE CODE IS SHOWN, NEVER TYPED BACK IN', () => {
  // The courier enters it in their own app and Uber will not let them complete
  // without it. Asking the attendant to re-type a number we have just put on her
  // screen would be theatre - what the button records is the one thing only she
  // knows, which is that the bags are physically on the counter.
  const html = page.board({
    lang: 'en',
    shop: { id: 'a', name: 'Riverside Wash Co', slug: 'riverside-wash-co' },
    orders: [],
    expected: [{ orderNumber: 9000, bagCount: 2, pin: '0160', status: 'pending' }],
  });

  assert.match(html, /0160/, 'the code a courier will ask for is not on the screen');
  assert.doesNotMatch(
    html,
    /name="pin"/,
    'the attendant is being asked to type back a code the page just showed her'
  );
});

test('and a booking with no code yet says so rather than rendering a hole', () => {
  const html = page.board({
    lang: 'en',
    shop: { id: 'a', name: 'Riverside Wash Co' },
    orders: [],
    expected: [{ orderNumber: 9000, bagCount: null, pin: null, status: 'pending' }],
  });

  // WITHOUT THE PAGE'S OWN SCRIPTS. The ops shell's menu code contains
  // `closeAll(null)`, which is ordinary JavaScript rather than a hole where a
  // value should have been.
  const shown = html.replace(/<script[\s\S]*?<\/script>/g, '');

  assert.doesNotMatch(shown, /undefined|null|NaN/, 'a missing code or bag count rendered as a hole');
});

test('CONFIRMING ARRIVAL DOES NOT GO THROUGH THE VAN, DELIBERATELY', () => {
  // `fulfilment.dropAtPartner()` calls `readyForPartner()`, which refuses
  // without `van_confirmed_at` - a column only `loadVan()` writes. Under a
  // courier there is no van to confirm, so that guard can never be satisfied and
  // its refusal ("Load the van first") is nonsense to an attendant.
  const src = SRC('core', 'courier-legs.js');
  const arrived = /async function arrived\([\s\S]*?\n}/.exec(src);

  assert.ok(arrived, 'arrived() has been renamed or removed');
  assert.doesNotMatch(arrived[0], /dropAtPartner|readyForPartner/, 'the courier path went back through the van');

  // But it still goes through the one thing allowed to move a status.
  assert.match(arrived[0], /orders\.transition\(/, 'a status is being written without orders.transition()');
});

test('AND IT USES transition() THE WAY transition() ACTUALLY WORKS', () => {
  // THE BUG THIS EXISTS FOR. `transition(order, to)` takes TWO arguments,
  // returns the order row, and THROWS on a refusal. The first version passed a
  // third argument and checked `step.ok` on the row that came back - so the
  // REQUESTED to IN_PROCESS hop succeeded, the missing property read as a
  // refusal, and the function stopped and reported failure. A real order was
  // left stranded half way with the attendant told to ring us.
  const src = SRC('core', 'courier-legs.js');
  const arrived = code(/async function arrived\([\s\S]*?\n}/.exec(src)[0]);

  assert.doesNotMatch(
    arrived,
    /transition\([^)]*,[^)]*,[^)]*\)/,
    'transition() is being passed a third argument it does not take'
  );

  // NO WORD BOUNDARY. `\b` written into a file through a shell heredoc has
  // collapsed to a literal backspace twice in this repo, which turns the regex
  // around it into one that can never match - see
  // test/no-control-characters.test.js. A close paren is what reading a result
  // object actually looks like, and it needs no escape to say so.
  assert.doesNotMatch(
    arrived,
    /\.ok\s*\)/,
    'the row transition() returns is being read as a result object again'
  );
  assert.match(arrived, /try\s*{/, 'transition() throws, so the hops must be caught');
});

test('a second press finishes the hops a first press did not', () => {
  // What makes a stranded order recoverable: the status is read fresh every
  // time, so pressing again does whichever hops are left rather than refusing
  // because the order is no longer where it started.
  const src = SRC('core', 'courier-legs.js');
  const arrived = /async function arrived\([\s\S]*?\n}/.exec(src)[0];

  assert.match(arrived, /order\.status === 'AT_PARTNER'/, 'an already-arrived order is not short-circuited');
  assert.match(
    arrived,
    /\['REQUESTED', 'IN_PROCESS'\]/,
    'arriving from IN_PROCESS is refused, so a half-moved order can never be finished'
  );
});
