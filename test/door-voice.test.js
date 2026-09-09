'use strict';

// ---------------------------------------------------------------------------
// WHICH DOOR AN ORDER CAME THROUGH DECIDES THE VOICE OF THE TEXT.
//
// Neil, reading the confirmation for an order he had just placed on the
// website: "there should have never been an 'of course'". A text that opens by
// agreeing is answering a question, and on a web form nobody asked one.
//
// This is exactly the kind of rule that regresses quietly - the sentence still
// sends, it just sounds wrong to one person in ten - so it is pinned here.
// Nothing in this file touches the database or the carrier.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const booking = require('../src/core/booking');

const customer = {
  address_line1: '1650 Chandler Dr',
  card_brand: 'visa',
  card_last4: '8663',
  preferences: {
    water_temp: 'COLD',
    fabric_softener: 'STANDARD',
    special_instructions: 'front door',
  },
};

const order = {
  order_number: 2032,
  pickup_date: '2026-09-09',
  pickup_window_start: '10:00',
  pickup_window_end: '12:00',
  pickup_method: 'LEAVE_OUTSIDE',
};

test('a booking made over text opens like a reply, because it is one', () => {
  const msg = booking.confirmationMessage(customer, order);
  assert.ok(msg.startsWith('Of course! Order #2032 is booked:'), msg.slice(0, 60));
});

test('a booking made on the website does not open by agreeing to anything', () => {
  const msg = booking.confirmationMessage(customer, order, { source: booking.DOORS.WEB });

  assert.ok(msg.startsWith('Order #2032 is booked:'), msg.slice(0, 60));
  assert.ok(!/of course/i.test(msg), 'the web confirmation must not say "of course"');
});

test('the door does not change anything except the opening clause', () => {
  const thread = booking.confirmationMessage(customer, order);
  const web = booking.confirmationMessage(customer, order, { source: booking.DOORS.WEB });

  // What a customer is told about their pickup cannot depend on where they
  // typed it. Strip the greeting and the two are the same document.
  assert.strictEqual(thread.replace('Of course! ', ''), web);
});

test('"Card saved" still wins over both, so the card is not named twice', () => {
  for (const source of [booking.DOORS.THREAD, booking.DOORS.WEB]) {
    const msg = booking.confirmationMessage(customer, order, { source, opener: 'Card saved' });
    assert.ok(msg.startsWith('Card saved! Order #2032 is booked:'), source + ': ' + msg.slice(0, 60));
  }
});

test('moving a pickup reads as an answer over text and as a fact on the web', () => {
  assert.ok(booking.rescheduledMessage(order).startsWith('No problem at all,'));

  const web = booking.rescheduledMessage(order, { source: booking.DOORS.WEB });
  assert.ok(web.startsWith('Your pickup has moved to'), web);
  assert.ok(!/no problem/i.test(web), 'the web reschedule must not say "no problem"');
});

test('an unknown source is treated as the thread, never as silence', () => {
  // The AI is the caller that must never have to remember, so anything that
  // is not explicitly the website keeps the conversational voice.
  const msg = booking.confirmationMessage(customer, order, { source: undefined });
  assert.ok(msg.startsWith('Of course!'), msg.slice(0, 40));
});
