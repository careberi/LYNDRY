'use strict';

// ---------------------------------------------------------------------------
// OPS NOISE IS QUIETER; NOTHING THAT WENT TO A CUSTOMER MOVES.
//
// Neil, 14 September. Most of what is pinned here is the second half of that
// sentence, because a filter on a message view is one edit away from hiding a
// text somebody actually received - and the whole value of `messages` is that
// it is the record of what reached a phone.
//
// The live data these were written against: one team number carrying 29
// outbound alerts with no customer, and three strangers with one inbound
// message each and no customer row.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const mv = require('../src/core/message-view');

const TEAM = mv.teamPhoneSet([{ phone: '+14437452665' }, { phone: '+12015550100' }]);

const alert = {
  direction: 'OUTBOUND',
  phone: '+14437452665',
  customer_id: null,
  body: 'New order #2066: Gail Marie Roehner',
};

// --- what counts as noise ---------------------------------------------------

test('an alert we send to ourselves is noise', () => {
  assert.equal(mv.isOpsAlert(alert, TEAM), true);
});

test('A CUSTOMER ON THE ROW MEANS IT IS NEVER NOISE', () => {
  // Even if it is outbound to a team number, which is what a team member
  // booking their own pickup looks like.
  assert.equal(mv.isOpsAlert({ ...alert, customer_id: 'cus_1' }, TEAM), false);
  assert.equal(mv.isOpsAlert({ ...alert, customers: { id: 'cus_1' } }, TEAM), false);
});

test('ANYTHING INBOUND IS NEVER NOISE, including from a stranger', () => {
  // Three numbers in the live data have exactly one inbound message and no
  // customer row. The conversations screen exists largely to show them.
  assert.equal(mv.isOpsAlert({ ...alert, direction: 'INBOUND' }, TEAM), false);
  assert.equal(
    mv.isOpsAlert({ direction: 'INBOUND', phone: '+12015099830', customer_id: null }, TEAM),
    false
  );
});

test('an outbound to somebody who is not on the team is never noise', () => {
  assert.equal(mv.isOpsAlert({ ...alert, phone: '+12019999999' }, TEAM), false);
});

test('a number formatted differently still matches', () => {
  // The team table and the messages table are written by different paths and
  // have never been guaranteed to agree on +1.
  assert.equal(mv.isOpsAlert({ ...alert, phone: '4437452665' }, TEAM), true);
  assert.equal(mv.isOpsAlert({ ...alert, phone: '(443) 745-2665' }, TEAM), true);
});

test('nothing crashes on a half-built row', () => {
  assert.equal(mv.isOpsAlert(null, TEAM), false);
  assert.equal(mv.isOpsAlert({}, TEAM), false);
  assert.equal(mv.isOpsAlert({ direction: 'OUTBOUND' }, TEAM), false);
});

// --- whole threads ----------------------------------------------------------

const alertThread = { phone: '+14437452665', customer: null, inbound: 0, total: 29, last: alert };

test('a thread that is only alerts is an alert thread', () => {
  assert.equal(mv.isOpsAlertThread(alertThread, TEAM), true);
});

test('ONE INBOUND MAKES IT A CONVERSATION AGAIN', () => {
  // A team member texting in about their own pickup must not be filed as noise.
  assert.equal(mv.isOpsAlertThread({ ...alertThread, inbound: 1 }, TEAM), false);
});

test('and so does a customer on it', () => {
  assert.equal(
    mv.isOpsAlertThread({ ...alertThread, customer: { id: 'c', name: 'Neil' } }, TEAM),
    false
  );
});

test('a stranger with one inbound is a conversation, not noise', () => {
  const stranger = { phone: '+12015099830', customer: null, inbound: 1, total: 1, last: {} };
  assert.equal(mv.isOpsAlertThread(stranger, TEAM), false);
});

// --- what the views do ------------------------------------------------------

test('customerVisible removes the alerts and NOTHING else', () => {
  const thread = [
    { direction: 'INBOUND', phone: '+12015551234', customer_id: 'c1', body: 'hey' },
    { direction: 'OUTBOUND', phone: '+12015551234', customer_id: 'c1', body: 'Booked.' },
    alert,
  ];
  const seen = mv.customerVisible(thread, TEAM);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((m) => m.body !== alert.body));
});

test('ON A REAL CUSTOMER THREAD IT REMOVES NOTHING AT ALL', () => {
  // Worth asserting rather than assuming: every message on such a thread
  // reached that customer, so there is nothing there to quieten. If this ever
  // drops a row, the filter has started hiding somebody's texts.
  const thread = [
    { direction: 'INBOUND', phone: '+12015551234', customer_id: 'c1', body: 'hey' },
    { direction: 'OUTBOUND', phone: '+12015551234', customer_id: 'c1', body: 'Booked.' },
    { direction: 'OUTBOUND', phone: '+12015551234', customer_id: 'c1', body: 'On our way.' },
  ];
  assert.deepEqual(mv.customerVisible(thread, TEAM), thread);
});

test('ALERTS ARE SORTED LAST, NEVER DROPPED', () => {
  // They are how anybody knows an issue was raised at three in the morning.
  const real = { phone: '+12015551234', customer: { name: 'A' }, inbound: 2, total: 4, last: {} };
  const out = mv.conversationsFirst([alertThread, real], TEAM);
  assert.equal(out.length, 2, 'a thread was dropped');
  assert.equal(out[0], real);
  assert.equal(out[1], alertThread);
});

test('an empty thread is not noise', () => {
  assert.equal(mv.isOpsAlertThread({ phone: '+14437452665', inbound: 0, total: 0 }, TEAM), false);
});

// --- it is a view, not a write ----------------------------------------------

test('NOTHING HERE WRITES, OR EVEN KNOWS HOW TO', () => {
  // A record you can tidy up is not evidence of anything. This file must never
  // grow a delete, an update, or a database handle at all.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'message-view.js'), 'utf8');
  assert.ok(!src.includes("require('../db')"), 'message-view reached for the database');
  assert.ok(!/\.delete\(|\.update\(|\.insert\(/.test(src), 'message-view can write');
});
