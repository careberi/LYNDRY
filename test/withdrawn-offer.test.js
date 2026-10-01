'use strict';

// ---------------------------------------------------------------------------
// AN OFFER TAKEN BACK IS SAID ONCE, TO THE PERSON, WHEN IT COMES UP.
//
// Neil, 1 October, on CLEAN50: "Everybody who holds the fifty percent off
// promotion does not have that anymore. It's totally gone." And: "Don't send
// any real text... If somebody places an order and they had it, just say this
// promotion is not available anymore. Just individually."
//
// So the promotion's ends_at withdraws it from holders, nothing is broadcast,
// and the two places a holder hears about it are the confirmation of their
// first order and Lyn's reply when they ask. Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const promotions = require('../src/core/promotions');
const booking = require('../src/core/booking');
const brain = require('../src/core/brain');
const notify = require('../src/core/notify');

const ENDED_AT = '2026-10-01T14:00:00Z';
const NOW = new Date('2026-10-01T15:00:00Z');
const CLEAN50 = { ends_at: ENDED_AT, blurb: '50% off your first order', status: 'ENDED' };

test('a grant still running when the promotion ended was taken back', () => {
  const grant = { expires_at: '2026-10-20T15:17:03Z', redeemed_at: null };
  assert.equal(promotions.withdrawn(grant, CLEAN50, NOW), true);
});

test('a grant that had already run out lost nothing', () => {
  const grant = { expires_at: '2026-09-30T10:00:00Z', redeemed_at: null };
  assert.equal(promotions.withdrawn(grant, CLEAN50, NOW), false);
});

test('a grant already spent was not taken back', () => {
  const grant = { expires_at: '2026-10-20T15:17:03Z', redeemed_at: '2026-09-20T10:00:00Z' };
  assert.equal(promotions.withdrawn(grant, CLEAN50, NOW), false);
});

test('a promotion with no end date, or one still to come, withdraws nothing', () => {
  const grant = { expires_at: '2026-10-20T15:17:03Z', redeemed_at: null };
  assert.equal(promotions.withdrawn(grant, { ...CLEAN50, ends_at: null }, NOW), false);
  assert.equal(promotions.withdrawn(grant, { ...CLEAN50, ends_at: '2026-10-05T00:00:00Z' }, NOW), false);
});

test('a promotion past its end date is no longer honoured for anybody holding it', () => {
  assert.equal(promotions.honoured(CLEAN50, NOW), false);
  assert.equal(promotions.live({ ...CLEAN50, status: 'ACTIVE' }, NOW), false);
});

const customer = {
  address_line1: '1650 Chandler Dr',
  card_brand: 'visa',
  card_last4: '8663',
  preferences: {},
};

const order = {
  order_number: 2090,
  pickup_date: '2026-10-02',
  pickup_window_start: '09:00',
  pickup_window_end: '12:00',
  pickup_method: 'LEAVE_OUTSIDE',
};

test('the confirmation says the offer is gone, once, after the price', () => {
  const msg = booking.confirmationMessage(customer, order, { endedOffer: CLEAN50.blurb });
  const line = 'Just so you know, 50% off your first order is no longer available.';
  assert.equal(msg.split(line).length - 1, 1);
  assert.ok(msg.indexOf(line) > msg.indexOf('$2.00'), 'after the money sentence');
});

test('the sentence is plain text a phone sends as one encoding', () => {
  const line = promotions.withdrawnLine(CLEAN50.blurb);
  assert.match(line, /^[\x20-\x7E]+$/);
  assert.equal(notify.toPlainText(line), line);
});

test('nobody else is told about an offer they never had', () => {
  const msg = booking.confirmationMessage(customer, order);
  assert.doesNotMatch(msg, /no longer available/);
  assert.equal(promotions.withdrawnLine(null), '');
});

test('Lyn is told it is gone, and told it only when there is one', () => {
  const with_ = brain.systemPrompt('2026-10-01', { date: '2026-10-01', time: '11:00' }, { endedOffer: CLEAN50.blurb });
  const without = brain.systemPrompt('2026-10-01', { date: '2026-10-01', time: '11:00' });
  assert.match(with_, /IT IS NO LONGER AVAILABLE: 50% off your first order/);
  assert.match(with_, /Never tell them they still have it/);
  assert.doesNotMatch(without, /NO LONGER AVAILABLE/);
});

// EVERY DOOR THAT SENDS A CONFIRMATION PASSES IT. Same shape as the free-order
// flag beside it: a door that forgets is a holder booked without being told.
// Driven off the calls themselves, so a new door is checked without being named.
test('every confirmation that passes freeUpToLb also passes endedOffer', () => {
  const files = [
    'src/core/actions.js',
    'src/core/card-saved.js',
    'src/routes/account.js',
    'src/routes/admin.js',
  ];
  let calls = 0;
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const parts = src.split('booking.confirmationMessage(').slice(1);
    for (const part of parts) {
      const args = part.slice(0, part.indexOf('})') + 2);
      if (!/freeUpToLb/.test(args)) continue;
      calls += 1;
      assert.match(args, /endedOffer/, `${file}: a confirmation without endedOffer`);
    }
  }
  assert.ok(calls >= 6, `expected at least six confirmation doors, found ${calls}`);
});
