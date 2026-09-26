'use strict';

// ---------------------------------------------------------------------------
// WHERE WE WORK.
//
// Neil, 25 September, in two parts: within ten miles of a laundromat wherever
// that reaches, and "just keep it inside of new jersey and outside of new york
// city". That replaced a list of 67 Bergen County ZIP codes.
//
// IT HAD NO TEST AT ALL, which is worth saying because it is the one check that
// decides whether we accept work nobody can do. `grep inServiceArea test/`
// found one comment.
//
// THE SERVICE AREA IS A FUNCTION OF WHO DRIVES. Under the van the round starts
// in Fair Lawn and the county is the boundary; under a courier the driving is
// door-to-laundromat and the only thing that matters is how far apart those are.
// `config.courier.model` says which world we are in, and the pure rules below
// are tested in both.
//
// EVERY DISTANCE HERE IS COMPUTED, NEVER TYPED. A test asserting "Park Ridge is
// 9.8 miles from Glen Rock" is asserting a number nobody can check; these build
// a point at a measured distance and say so if the measurement is wrong.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const booking = require('../src/core/booking');
const geocode = require('../src/core/geocode');
const { config } = require('../src/config');

const MAX = config.courier.maxMiles;

// A laundromat in Glen Rock, and points north of it at measured distances.
const SHOP = { lat: 40.9626, lng: -74.1327 };
const MILES_PER_DEGREE_LAT = 69.0;
const northOf = (shop, miles) => ({ lat: shop.lat + miles / MILES_PER_DEGREE_LAT, lng: shop.lng });

const nj = (extra) => ({ state: 'NJ', postal_code: '07452', ...extra });

test('THE DISTANCES THIS FILE RELIES ON ARE REAL', () => {
  // If the offset arithmetic is wrong, every case below tests nothing. Checked
  // first so a broken helper fails here rather than passing everywhere.
  for (const miles of [1, 5, MAX - 0.5, MAX + 2]) {
    const measured = geocode.milesBetween(SHOP, northOf(SHOP, miles));
    assert.ok(
      Math.abs(measured - miles) < 0.1,
      `the helper claimed ${miles} miles and the maths says ${measured.toFixed(2)}`
    );
  }
});

// --- New Jersey, and not New York City --------------------------------------

test('NEW JERSEY IS WHAT KEEPS NEW YORK CITY OUT', () => {
  assert.equal(booking.inNewJersey({ state: 'NJ' }), true);
  assert.equal(booking.inNewJersey({ state: 'nj' }), true, 'the state is compared case-sensitively');
  assert.equal(booking.inNewJersey({ state: 'NY' }), false);
  assert.equal(booking.inNewJersey({ state: 'NY', postal_code: '10036' }), false);
});

test('and a row with no state falls back to the ZIP, which separates them cleanly', () => {
  // New Jersey is 07000-08999 and New York City is 10001-11697, so no list is
  // needed and there is nothing to maintain.
  assert.equal(booking.inNewJersey({ postal_code: '07452' }), true, 'a Bergen ZIP');
  assert.equal(booking.inNewJersey({ postal_code: '08608' }), true, 'Trenton is still New Jersey');
  assert.equal(booking.inNewJersey({ postal_code: '10036' }), false, 'Times Square');
  assert.equal(booking.inNewJersey({ postal_code: '11201' }), false, 'Brooklyn');
  assert.equal(booking.inNewJersey({ postal_code: '10courier' }), false, 'junk in the ZIP column');
});

test('A BLANK STATE IS NO LONGER A WAY IN, WHICH IT USED TO BE', () => {
  // The old check read `if (state && state !== 'NJ')`, so a missing state passed
  // and the ZIP list did the work. Harmless against 67 Bergen codes. Against a
  // radius it is not: Manhattan is inside ten miles of both Carlstadt and
  // Englewood, so a blank state plus a New York ZIP has to be refused here.
  assert.equal(booking.inNewJersey({}), false, 'a row with neither a state nor a ZIP was let in');
  assert.equal(booking.inNewJersey({ state: '', postal_code: '' }), false);
  assert.equal(booking.inNewJersey(null), false);
});

// --- within ten miles of a laundromat ---------------------------------------

test('WITHIN REACH IS MEASURED AS THE CROW FLIES, AND THE EDGE IS INCLUSIVE', () => {
  const shops = [SHOP];

  assert.equal(booking.withinReachOf(northOf(SHOP, 1), shops), true);
  assert.equal(booking.withinReachOf(northOf(SHOP, MAX - 0.5), shops), true);
  assert.equal(booking.withinReachOf(northOf(SHOP, MAX + 2), shops), false);
});

test('ANY ONE LAUNDROMAT IS ENOUGH, WHICH IS THE WHOLE RULE', () => {
  // Measured against Uber's own API: Mahwah to a Hackensack laundromat is
  // refused and Mahwah to a Glen Rock one is $10.99. Serviceability is a
  // property of the PAIR, so being far from most of them decides nothing.
  const far = { lat: SHOP.lat + 1, lng: SHOP.lng };
  const customer = northOf(SHOP, 4);

  assert.equal(booking.withinReachOf(customer, [far]), false);
  assert.equal(booking.withinReachOf(customer, [far, SHOP]), true, 'a reachable laundromat was ignored');
  assert.equal(booking.withinReachOf(customer, [SHOP, far]), true, 'the order of the list mattered');
});

test('THE ROAD FACTOR MUST NOT DRAW THE BOUNDARY', () => {
  // It turned a real Park Ridge address 9.8 miles from Glen Rock into 12.7 and
  // put it outside - and Uber then quoted that exact trip for $10.99. The road
  // factor estimates a COST; it has no business deciding who we serve.
  const justInside = northOf(SHOP, MAX - 0.2);
  const roadMiles = geocode.milesBetween(SHOP, justInside) * config.routing.roadFactor;

  assert.ok(roadMiles > MAX, 'this case no longer reproduces the bug it exists for');
  assert.equal(
    booking.withinReachOf(justInside, [SHOP]),
    true,
    'the boundary is being drawn on road-inflated miles again'
  );
});

// --- the three ways it can fail to know -------------------------------------

test('AN ADDRESS NOBODY COULD PLACE IS NOT REFUSED', () => {
  // Bergen uses hyphenated house numbers and free geocoders miss them
  // constantly. Silence is not an accusation - the rule the rest of booking.js
  // already follows - and `bookPickup()` has New Jersey either way.
  assert.equal(booking.withinReachOf({ lat: null, lng: null }, [SHOP]), true);
  assert.equal(booking.withinReachOf({}, [SHOP]), true);
});

test('NULL LAUNDROMATS MEANS WE COULD NOT ASK; AN EMPTY LIST MEANS THERE ARE NONE', () => {
  const customer = northOf(SHOP, 1);

  // A failed query must never read as an empty county: it would refuse every
  // booking in the business.
  assert.equal(booking.withinReachOf(customer, null), true, 'an unreadable partners table closed the business');

  // No laundromat at all is a real refusal - there is nothing to wash with.
  assert.equal(booking.withinReachOf(customer, []), false);
});

test('A LIST WHERE NOTHING IS PINNED FAILS OPEN, BECAUSE THAT IS THE SELECT BUG', () => {
  // The trap CLAUDE.md records against CARD_FIELDS, BOARD_FIELDS and RUN_FIELDS,
  // for the eleventh time: a column left out of a select comes back undefined,
  // which is indistinguishable from empty. `activeLaundromats()` did not select
  // lat or lng, and a loop that simply skipped unpinned shops would have found
  // nobody in range and refused EVERY booking with "outside our area" - caused
  // by two missing words in a query.
  const unpinned = [{ id: 'a', name: 'somewhere' }, { id: 'b', name: 'elsewhere' }];

  assert.equal(
    booking.withinReachOf(northOf(SHOP, 500), unpinned),
    true,
    'a list with no coordinates in it was treated as a real answer'
  );
});

test('and the query that feeds it selects the two columns', () => {
  // ASSERTED AGAINST THE FUNCTION BODY, NOT THE FILE. CLAUDE.md records two
  // tests that passed for free by matching a whole file, so this cuts the one
  // function out first.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'partners.js'), 'utf8');
  const body = /async function activeLaundromats\(\)[\s\S]*?\n}/.exec(src);

  assert.ok(body, 'activeLaundromats() has been renamed or removed');
  assert.match(body[0], /\blat\b/, 'lat is no longer selected, so the service area cannot be measured');
  assert.match(body[0], /\blng\b/, 'lng is no longer selected, so the service area cannot be measured');
});

// --- the two together -------------------------------------------------------

test('NEW YORK IS REFUSED EVEN STANDING NEXT TO A LAUNDROMAT', async () => {
  // The case the state check exists for. A Manhattan address is well inside ten
  // miles of Carlstadt, and Uber happens to refuse it - but a boundary that only
  // holds because a vendor agrees with it is not a boundary.
  const inManhattan = { state: 'NY', postal_code: '10036', ...northOf(SHOP, 2) };

  assert.equal(await booking.inServiceArea(inManhattan, [SHOP], { courier: courierThatSaysYes }), false);
});

// A COURIER THAT ANSWERS WITHOUT A NETWORK. `npm test` reached Uber's live API
// the moment the boundary started asking one - two seconds a case, and a suite
// that fails when somebody else's sandbox does. Nothing in test/ may depend on a
// vendor being up, for the same reason nothing in it touches the database.
const courierThatSaysYes = { quote: async () => ({ ok: true, feeCents: 1099 }) };
const courierThatSaysNo = { quote: async () => ({ ok: false, reason: 'address_undeliverable' }) };
const courierThatIsDown = {
  quote: async () => {
    throw new Error('sandbox is having a bad afternoon');
  },
};

test('a New Jersey address the courier will take is in', async () => {
  const near = nj(northOf(SHOP, 3));

  assert.equal(await booking.inServiceArea(near, [SHOP], { courier: courierThatSaysYes }), true);
});

test('AND THE COURIER DECIDES IT, NOT A RULER', async () => {
  // The change Neil asked for: "lets not use the straight as the crow flies
  // method then and use uber's driving miles". An address three miles away that
  // the courier refuses is refused, and one at nine miles that it accepts is in.
  const near = nj(northOf(SHOP, 3));
  const nearlyMax = nj(northOf(SHOP, MAX - 0.6));

  if (config.courier.model !== 'DYNAMIC') return; // the van model uses the ZIP list

  assert.equal(
    await booking.inServiceArea(near, [SHOP], { courier: courierThatSaysNo }),
    false,
    'a courier refusal was overruled by the distance'
  );
  assert.equal(
    await booking.inServiceArea(nearlyMax, [SHOP], { courier: courierThatSaysYes }),
    true,
    'a trip the courier priced was refused by our own ruler'
  );
});

test('A COURIER WE CANNOT REACH DOES NOT CLOSE THE BUSINESS', async () => {
  // Fails open onto the radius, which is exactly what decided this before
  // anybody was asked. Refusing every booking because a vendor is having a bad
  // minute is far worse than taking one somebody later has to ring about.
  if (config.courier.model !== 'DYNAMIC') return;

  const near = nj(northOf(SHOP, 3));
  assert.equal(await booking.inServiceArea(near, [SHOP], { courier: courierThatIsDown }), true);
});

test('but New Jersey is still checked when the courier is down', async () => {
  // It costs no API call and it is the one rule a courier cannot answer for us:
  // Uber quotes a Manhattan trip perfectly happily, at $7.99 plus their $5 New
  // York surcharge.
  if (config.courier.model !== 'DYNAMIC') return;

  const manhattan = { state: 'NY', postal_code: '10036', ...northOf(SHOP, 2) };
  assert.equal(await booking.inServiceArea(manhattan, [SHOP], { courier: courierThatIsDown }), false);
});

test('IT IS ASYNC, SO A CALLER THAT FORGETS TO AWAIT CANNOT PASS SILENTLY', async () => {
  // A Promise is truthy, so `if (!inServiceArea(x))` never refuses anybody. It
  // is worth one assertion that this is a Promise, because that mistake is
  // invisible: every booking would be accepted and nothing would error.
  const answer = booking.inServiceArea(nj(northOf(SHOP, 3)), [SHOP], { courier: courierThatSaysYes });

  assert.ok(typeof answer.then === 'function', 'inServiceArea stopped being async');
  assert.equal(await answer, true);
});

test('NOTHING SAYS BERGEN COUNTY WHEN THE BOUNDARY IS NOT BERGEN COUNTY', () => {
  const words = booking.serviceAreaWords();

  if (config.courier.model === 'DYNAMIC') {
    assert.doesNotMatch(words, /bergen/i, 'the service area still calls itself Bergen County');
    assert.match(words, /New Jersey/);
    assert.match(words, new RegExp(String(MAX)), 'the radius is not named, so it is a second copy waiting to drift');
  } else {
    assert.match(words, /Bergen/);
  }
});
