'use strict';

// ---------------------------------------------------------------------------
// A TAG IS RETIRED BY A DELIVERY, AND BY NOTHING ELSE.
//
// Neil, 15 September, on order #2067: a tag on a bag sitting at a laundromat
// read "dead - the order was delivered". Nothing had been delivered. The door
// charge succeeded, the decline path ran anyway, and that path called
// releaseOrder() - so a flag meaning "the customer has their laundry back" was
// set on an order we were still holding, and two ops screens repeated it as
// fact.
//
// The caller that did it was removed when #2068 was fixed. What is pinned here
// is the half that cannot be forgotten by the NEXT caller, because a comment
// saying "only call this from a delivery" is a rule nobody reads at three in
// the morning and there have now been two of them.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split('\r\n')
    .join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

function bodyOf(src, signature) {
  const at = src.indexOf(signature);
  assert.notEqual(at, -1, `${signature} has moved`);
  const end = src.indexOf('\n}\n', at);
  assert.notEqual(end, -1, `no end for ${signature}`);
  return withoutComments(src.slice(at, end));
}

// --- the guard --------------------------------------------------------------

test('RELEASEORDER REFUSES ANYTHING THAT IS NOT A DELIVERY', () => {
  const body = bodyOf(SRC('core', 'bags.js'), 'async function releaseOrder(');

  // It reads the order rather than trusting the caller.
  assert.match(body, /from\('orders'\)/, 'releaseOrder no longer reads the order');
  assert.match(body, /RELEASABLE_FROM/, 'the guard is gone');
  assert.match(body, /not_a_delivery/);

  // And the refusal comes BEFORE the write, or it is not a guard.
  const refuses = body.indexOf('not_a_delivery');
  const writes = body.indexOf('released_at:');
  assert.ok(refuses > -1 && writes > -1);
  assert.ok(refuses < writes, 'the tags are retired before the status is checked');
});

test('and only the two delivery statuses are on the list', () => {
  const bags = require('../src/core/bags');
  const src = withoutComments(SRC('core', 'bags.js'));

  // OUT_FOR_DELIVERY has to be there: the driver strips the tags on the
  // doorstep as step two, before the photo that moves the order to DELIVERED.
  assert.match(src, /RELEASABLE_FROM = Object\.freeze\(\['OUT_FOR_DELIVERY', 'DELIVERED'\]\)/);

  // IN_PROCESS is a doorstep decline and AT_PARTNER is a bag on somebody
  // else's shelf. Neither is a delivery, and #2067 was the second.
  assert.ok(!/RELEASABLE_FROM[^)]*IN_PROCESS/.test(src));
  assert.ok(!/RELEASABLE_FROM[^)]*AT_PARTNER/.test(src));

  assert.equal(typeof bags.releaseOrder, 'function');
});

test('IT FAILS CLOSED, leaving the tag alone when it cannot tell', () => {
  // A tag left live on a delivered bag opens a page about laundry somebody
  // already has. A tag wrongly retired stops a laundromat scanning a bag it is
  // holding. The second is the one that stops work.
  const body = bodyOf(SRC('core', 'bags.js'), 'async function releaseOrder(');

  assert.match(body, /if \(readError\)/, 'an unreadable order still retires the tags');
  assert.match(body, /if \(!order \|\|/, 'a missing order still retires the tags');
});

// --- the screens --------------------------------------------------------------

test('THE OPS LABEL STATE FOLLOWS THE ORDER, NOT THE FLAG', () => {
  const { labelState } = require('../src/routes/admin');

  const live = { released_at: null, order_id: 'o' };
  const blank = { released_at: null, order_id: null };
  const retired = { released_at: 'x', order_id: 'o' };

  assert.equal(labelState(blank), 'OUTSTANDING');
  assert.equal(labelState(live, { status: 'AT_PARTNER' }), 'IN_USE');

  // Retired AND finished is the only thing that is really expired.
  assert.equal(labelState(retired, { status: 'DELIVERED' }), 'EXPIRED');
  assert.equal(labelState(retired, { status: 'CANCELED' }), 'EXPIRED');

  // #2067 exactly: released_at set on an order still at a laundromat. The
  // truthful answer is the one the tag page already gives - the bag is ours,
  // so the tag is in use - which also heals both screens at once.
  assert.equal(labelState(retired, { status: 'AT_PARTNER' }), 'IN_USE');
  assert.equal(labelState(retired, { status: 'IN_PROCESS' }), 'IN_USE');
  assert.equal(labelState(retired, { status: 'OUT_FOR_DELIVERY' }), 'IN_USE');
});

test('and it reads the status off the joined row when no order is passed', () => {
  const { labelState } = require('../src/routes/admin');
  assert.equal(
    labelState({ released_at: 'x', order_id: 'o', orders: { status: 'AT_PARTNER' } }),
    'IN_USE'
  );
});

test('NOTHING PRINTS "DELIVERED" UNLESS THE ORDER WAS DELIVERED', () => {
  // Two screens said it, and both said it of every retired tag whatever had
  // actually happened to the order.
  // EVERY occurrence, not the first. There are three of them in admin.js - the
  // labels list, the tag detail page and the order page's own bag rows - and
  // checking only the first is how the third one survived the first pass.
  for (const file of [['routes', 'admin.js'], ['web', 'labels.js']]) {
    const body = withoutComments(SRC(...file));
    const where = file.join('/');

    let at = body.indexOf('the order was');
    let found = 0;

    while (at !== -1) {
      found += 1;
      // The sentence sits inside a status test rather than being printed flat.
      const around = body.slice(Math.max(0, at - 340), at + 80);
      assert.match(
        around,
        /CANCELED/,
        `${where}: occurrence ${found} claims delivery whatever the status is`
      );
      at = body.indexOf('the order was', at + 1);
    }

    assert.ok(found > 0, `${where}: the wording has moved`);
  }
});

test('AND THE STATUS IS SELECTED, or none of it can be asked', () => {
  // An unselected column reads as undefined, nothing is ever finished, and
  // every retired tag lists as In use - the same trap from the other side.
  const src = withoutComments(SRC('routes', 'admin.js'));
  assert.match(src, /orders\(order_number, status\)/, 'the labels list stopped selecting the status');
  assert.match(src, /orders\(id, order_number, status\)/, 'the tag detail stopped selecting the status');
});
