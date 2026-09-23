'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { config } = require('../src/config');
const { site } = require('../src/web/site');
const booking = require('../src/core/booking');

// ---------------------------------------------------------------------------
// THE FACTS THE LIVE GOOGLE ADS DEPEND ON.
//
// Two campaigns went live on 23 September at $80 a day, and every ad and asset
// in them states a handful of things as fact: next day, from $1.80 a pound, a
// $25 minimum, no delivery fee. Those are not written down anywhere in this
// repo, because they are typed into an advertising account. So the day somebody
// moves a price or a window here, the ads keep saying the old number to people
// who are paying to read it, and nothing anywhere notices.
//
// THIS FILE IS THE NOTICING. It asserts nothing about how the code works - only
// that the figures the adverts quote are still the figures the system charges.
// A failure here is not a bug in the code; it means the ads have to be changed
// the same day, and it is deliberately worded to say so.
//
// SO IT MUST STAY CHEAP AND DULL. Every value is read from where the running
// system reads it - config.js, site.js, booking.js - and there is no database,
// no network and nothing mocked. A test that needed maintaining would be the
// first one switched off, and this one is worth more than it costs precisely
// because it never needs touching until it is telling the truth about a change
// somebody just made.
//
// WHAT IS NOT IN HERE: the discount. There is none in the ads, and
// test/no-automatic-offer.test.js already refuses to let one appear
// automatically. Two files asserting the same rule is two things to edit.
// ---------------------------------------------------------------------------

const ADS_MUST_CHANGE = 'The live Google ads say otherwise. Change the ads the same day.';

test('the ads say next day, and so does the site', () => {
  assert.equal(
    site.turnaround,
    'next day',
    `Every advert says "back the next day". ${ADS_MUST_CHANGE}`
  );
});

test('the ads say from $1.80 a pound, and $1.80 is really the cheapest rate', () => {
  const oneTime = config.pricing.perPoundCents;
  const subscription = config.pricing.subscriptionPerPoundCents;

  assert.equal(subscription, 180, `The ads say "from $1.80 a pound". ${ADS_MUST_CHANGE}`);
  assert.equal(oneTime, 200, `The site and the texts say $2.00 one-time. ${ADS_MUST_CHANGE}`);

  // "FROM" IS ONLY HONEST WHILE THE SUBSCRIPTION IS THE FLOOR. If a cheaper
  // rate ever exists, "from $1.80" stops being the lowest price we offer and
  // starts being a number somebody picked - which is the shape of claim that
  // gets an advertiser in trouble rather than merely being out of date.
  assert.ok(
    subscription <= oneTime,
    `"From $1.80 a pound" claims $1.80 is the cheapest rate there is. ${ADS_MUST_CHANGE}`
  );
});

test('the ads say a $25 minimum, and the minimum is $25', () => {
  assert.equal(
    config.pricing.minimumCents,
    2500,
    `Every advert says a $25 minimum. ${ADS_MUST_CHANGE}`
  );
});

test('no window starts after 4pm, which is why the ads must never say tonight', () => {
  const windows = booking.PICKUP_WINDOWS;
  assert.ok(windows.length > 0, 'there are no pickup windows at all');

  const minutes = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
  };

  // THE DAY ENDS AT 6PM. An advert offering an evening collection would be
  // promising a van that does not run, and the phrase that does it is "tonight"
  // - which an earlier draft of the ads carried and which was taken out for
  // exactly this reason.
  const lastEnd = Math.max(...windows.map((w) => minutes(w.end)));
  assert.ok(
    lastEnd <= 18 * 60,
    `The last pickup window now ends at ${lastEnd / 60}:00. An advert may promise ` +
      `an evening pickup only if one exists. ${ADS_MUST_CHANGE}`
  );

  // AND A WINDOW CLOSES THE MOMENT IT STARTS, which is booking.js's rule rather
  // than this file's. So the last moment anybody can book today is the START of
  // the final window, not its end: after 4pm the soonest pickup is tomorrow
  // morning, whatever the clock says. That is the fact that makes "book by 8pm,
  // bag out tonight" untrue, and it is why no cutoff of that shape was built.
  const lastStart = Math.max(...windows.map((w) => minutes(w.start)));
  assert.ok(
    lastStart <= 16 * 60,
    `The last window now starts at ${lastStart / 60}:00. Nothing can be booked ` +
      `for today after that. ${ADS_MUST_CHANGE}`
  );
});

test('the ads say pickup and delivery are free, and nothing adds a fee', () => {
  // There is no delivery fee anywhere in the system and there never has been -
  // the per-pound rate and the minimum are the whole price. This asserts the
  // absence rather than a value, because the way this claim would become false
  // is somebody ADDING a setting, and a test that reads a field that does not
  // exist yet cannot catch that.
  const fees = Object.keys(config.pricing).filter((key) => /fee|delivery|surcharge/i.test(key));
  assert.deepEqual(
    fees,
    [],
    `Pricing has gained ${fees.join(', ')}. Every advert says free pickup and ` +
      `delivery and no delivery fee. ${ADS_MUST_CHANGE}`
  );
});
