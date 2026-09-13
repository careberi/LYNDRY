'use strict';

// ---------------------------------------------------------------------------
// NEXT DAY MEANS THE WHOLE OF THE NEXT DAY.
//
// Neil, 13 September, reading "9h 51m left" on order #2060: "if we have picked
// up the order on day 1, we have the whole day 2 to drop it off, not 24hrs
// after we picked it up, not until we are closed. we have until day 2 is over."
//
// Two wrong versions of this promise have shipped, and both are pinned here so
// neither comes back:
//
//   24 hours from collection  gave two customers on one round deadlines eight
//                             hours apart, and matched nothing either was told.
//   the last PICKUP window    let the hours we offer to COLLECT in decide when
//                             a DELIVERY was late.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { dueAt, turnaround } = require('../src/core/fulfilment');
const booking = require('../src/core/booking');

// New Jersey time, written as the UTC instant it actually is.
const nj = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York' });

test('a bag collected in the morning is due at the end of the NEXT day', () => {
  // 8am Saturday 12 Sep, New Jersey.
  const due = dueAt({ collected_at: '2026-09-12T12:00:00Z' });
  assert.match(nj(due), /^9\/13\/2026, 11:59:00 PM$/, nj(due));
});

test('a bag collected in the evening is due at the same moment', () => {
  // THE ORIGINAL BUG. Under 24-hours-from-collection this was a different
  // deadline from the one above; it is the same laundry on the same round.
  const morning = dueAt({ collected_at: '2026-09-12T12:00:00Z' });
  const evening = dueAt({ collected_at: '2026-09-12T21:30:00Z' });
  assert.equal(morning, evening);
});

test('order #2060: collected mid-afternoon, due the end of the following day', () => {
  const due = dueAt({ collected_at: '2026-09-12T19:00:36Z' });
  assert.match(nj(due), /^9\/13\/2026, 11:59:00 PM$/, nj(due));
});

test('the deadline is NOT the end of the van\'s round', () => {
  // The second wrong version. The last pickup window closes at 6pm; the
  // promise does not, and a delivery at seven in the evening on day two is
  // exactly what the customer was told they would get.
  const due = dueAt({ collected_at: '2026-09-12T12:00:00Z' });
  const lastWindow = booking.PICKUP_WINDOWS[booking.PICKUP_WINDOWS.length - 1].end;

  assert.notEqual(booking.endOfPromiseDay(), lastWindow);
  assert.ok(!/6:00:00 PM/.test(nj(due)), nj(due));
});

test('a pickup that runs past midnight is measured by the day it happened on', () => {
  // 11:30pm Saturday New Jersey is Sunday in UTC. Using UTC would push the
  // deadline a whole day out.
  const due = dueAt({ collected_at: '2026-09-13T03:30:00Z' });
  assert.match(nj(due), /^9\/13\/2026, 11:59:00 PM$/, nj(due));
});

test('nothing collected has no clock, and neither does anything finished', () => {
  // A countdown only means something while we are holding somebody's clothes.
  assert.equal(dueAt({ collected_at: null }), null);
  assert.equal(turnaround({ collected_at: null }), null);
  assert.equal(turnaround({ collected_at: '2026-09-12T12:00:00Z', status: 'DELIVERED' }), null);
  assert.equal(turnaround({ collected_at: '2026-09-12T12:00:00Z', status: 'CANCELED' }), null);
});

test('the routing board and the countdown read the same promise', () => {
  // If the badge on an order and the laundromat chosen for it disagreed about
  // when it is late, one would be picking a partner that cannot keep a promise
  // the other is still counting down.
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'core', 'dispatch.js'),
    'utf8'
  );
  assert.ok(source.includes('booking.endOfPromiseDay()'), 'dispatch stopped using the shared promise');
  assert.ok(!source.includes('endOfDeliveryDay'), 'dispatch is back on the old pickup-window deadline');
});
