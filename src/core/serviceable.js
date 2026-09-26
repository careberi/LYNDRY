'use strict';

const { config } = require('../config');
const geocode = require('./geocode');
const couriers = require('../providers/couriers');

// ---------------------------------------------------------------------------
// CAN WE ACTUALLY DO THIS ADDRESS, AND WHAT WOULD THE DRIVING COST.
//
// Neil, 25 September, twice and in two different words:
//
//   "we should always check with uber to see if we can deliver to a location
//    before we tell someone we can"
//   "lets not use the straight as the crow flies method then and use uber's
//    driving miles to quote delivery fees"
//
// SO THE COURIER IS THE ANSWER AND A RULER IS NOT. Everything a customer is
// told - whether we come, and what the driving costs - comes from asking a
// courier about their actual address. Straight-line distance keeps exactly one
// job, which is deciding WHICH laundromats are worth asking about, and it may
// never say yes or no to a person.
//
// WHY A RULER CANNOT DO IT, MEASURED RATHER THAN ARGUED. From the Carlstadt
// laundromat: Hackensack is 4.6 miles across the map and Uber routes it into
// their 7-10 band, because the road goes around the Meadowlands and over the
// river. Glen Rock is 9.4 miles across the map - twice as far - and lands in
// the SAME band, because it is a straight run up Route 17. The implied road
// factor ranges from about 1.0 to over 2.2 inside one county, so there is no
// multiplier that makes a straight line into Uber's miles.
//
// A REFUSAL REMOVES A LAUNDROMAT AND NEVER A CUSTOMER. Somebody fifteen miles
// from the nearest shop today is somebody the next shop serves. Every town
// tested prices a short trip inside itself, Manhattan included, so a laundromat
// in Jersey City would serve Jersey City customers perfectly. What a courier
// refuses is the TRIP, which reads like a coverage refusal and is not one.
//
// HOW FAR UBER WILL ACTUALLY GO IS NOT KNOWN, AND THIS FILE MUST NOT PRETEND
// OTHERWISE. Two figures are in front of us and they disagree:
//
//   10 routed miles   Uber's published pricing table has no band past 7-10,
//                     which is where the earlier "Uber stops at ten" came from.
//                     It is a fact about their PRICE LIST, not an answer they
//                     have ever given us.
//   20 miles          CleanCloud's Uber FAQ, 25 September: "Uber covers
//                     deliveries up to 20 miles from your store address."
//                     CleanCloud is a reseller, so that may be a different
//                     product, a different tier, or simply their own number.
//
// AND TEST MODE CANNOT SETTLE IT, which is the thing worth knowing before
// anybody trusts a dev booking. Uber's test API quotes Fair Lawn to LOS ANGELES
// at $7.99 and 63 minutes - the identical canned answer it gives for Hackensack
// four miles away. It refuses nothing and it prices nothing, so on the
// development site the courier is not deciding the service area at all. What
// keeps dev sane is `inNewJersey()` below and this shortlist; neither is Uber.
// ---------------------------------------------------------------------------

// HOW FAR OUT WE BOTHER ASKING, as the crow flies.
//
// THIS IS NOT THE SERVICE AREA AND MUST NEVER BECOME ONE. It exists so that a
// page anybody can type into does not fire a courier quote at all fifty
// laundromats.
//
// IT WAS 15 AND THAT WAS TOO TIGHT TO BE SAFE. `SHORTLIST_SIZE` caps the number
// of API calls at three however wide this is, so widening it costs nothing at
// all - it changes WHICH laundromats get asked, never HOW MANY. Which means a
// number that sits below the courier's real limit has only one effect: it turns
// away customers the courier would have carried, silently, as though they were
// out of area. At 15 that was live risk, because one of the two figures above is
// 20.
//
// So it is set above BOTH of them. If Uber's limit is 10 the refusals draw the
// line, as designed; if it is 20 they still do. The only thing this number can
// now do is stop a booking form asking about a laundromat in another state.
const SHORTLIST_MILES = 30;

// How many get a live quote. Every one is an API call on a public page.
const SHORTLIST_SIZE = 3;

// --- the free half, which needs no API call --------------------------------

// NEW JERSEY, WHICH IS WHAT KEEPS NEW YORK CITY OUT.
//
// Neil: "just keep it inside of new jersey and outside of new york city". It is
// asked affirmatively and answered first, because it costs nothing and because
// a courier would happily quote a Manhattan trip - $12.99 for a short one,
// which is $7.99 plus their $5 New York surcharge. Uber agreeing is not our
// reason for serving somewhere.
function inNewJersey(customer) {
  const state = String((customer || {}).state || '').trim().toUpperCase();
  if (state) return state === 'NJ';

  // No state on the row, so the ZIP answers. New Jersey is 07000-08999 and New
  // York City is 10001-11697, so the two cannot be confused and there is no
  // list to maintain.
  const zip = String((customer || {}).postal_code || '').trim().slice(0, 5);
  return /^0[78]\d{3}$/.test(zip);
}

// The nearest few laundromats that are worth asking a courier about.
//
// PURE, so the shortlist rule is testable without a database or an API. Returns
// them nearest first, each carrying the straight-line miles that chose it - and
// nothing downstream may use that figure as a price or a promise.
function shortlist(at, laundromats, { maxMiles = SHORTLIST_MILES, take = SHORTLIST_SIZE } = {}) {
  if (!at || at.lat == null || at.lng == null) return [];

  return (laundromats || [])
    .filter((p) => p && p.lat != null && p.lng != null)
    .map((p) => ({ ...p, straightMiles: geocode.milesBetween(at, { lat: Number(p.lat), lng: Number(p.lng) }) }))
    .filter((p) => p.straightMiles <= maxMiles)
    .sort((a, b) => a.straightMiles - b.straightMiles)
    .slice(0, take);
}

// --- asking the courier -----------------------------------------------------

// The address in the shape a courier wants it, from a customer row.
function addressOf(customer) {
  const c = customer || {};
  return {
    line1: c.address_line1,
    line2: c.address_line2,
    city: c.city,
    state: c.state,
    postalCode: c.postal_code,
  };
}

function partnerAddress(partner) {
  return {
    line1: partner.address_line1,
    city: partner.city,
    state: partner.state,
    postalCode: partner.postal_code,
  };
}

// WHAT ONE LEG COSTS TO EACH SHORTLISTED LAUNDROMAT, asked in parallel.
//
// THREE ANSWERS, AND THEY ARE NOT THE SAME THING:
//
//   legCents   the courier will do it, for this much
//   refused    the courier answered no about THAT TRIP. Almost always "too
//              long", and never a statement about the town
//   null both  we could not ask. Our problem, not theirs, and it must not read
//              as a refusal - see the fail-open below
async function priceEach(from, shops, courier = couriers) {
  return Promise.all(
    shops.map(async (shop) => {
      try {
        const asked = await courier.quote({
          from,
          to: partnerAddress(shop),
          // For a courier with nobody to ask - the fake one in development -
          // which reads our band table. The real one ignores it and asks Uber.
          miles: shop.straightMiles * config.routing.roadFactor,
        });

        if (asked && asked.ok) return { shop, legCents: asked.feeCents, refused: null };
        return { shop, legCents: null, refused: (asked && asked.reason) || 'no_quote' };
      } catch (err) {
        console.error(`Could not ask a courier about ${shop.name}: ${err.message}`);
        return { shop, legCents: null, refused: null };
      }
    })
  );
}

// --- the answer -------------------------------------------------------------

// CAN WE SERVE THIS ADDRESS, AND FROM WHERE.
//
// `laundromats` is passed in, because which ones are active is a query and this
// is a rule. `at` is the customer's coordinates, or null when the geocoder could
// not place them.
//
// Returns one of:
//   { ok: true,  shop, legCents, quoted: true  }   a courier said yes
//   { ok: true,  shop, legCents: null, quoted: false }  we could not ask; see below
//   { ok: false, reason }                          refused, and why
// `courier` IS INJECTABLE AND DEFAULTS TO THE REAL ADAPTER, so the rules here
// can be tested without a network call. `npm test` reached Uber's live API the
// moment this function existed - two seconds a case, and a suite that fails when
// somebody else's sandbox does. Nothing in `test/` may depend on a vendor being
// up, for the same reason nothing in it touches the database.
async function reachable(customer, { laundromats, at = null, courier = couriers, maxMiles = SHORTLIST_MILES } = {}) {
  // FIRST, AND FOR NOTHING. No API call, and it is the rule a courier cannot
  // answer for us.
  if (!inNewJersey(customer)) return { ok: false, reason: 'outside_nj' };

  const shops = laundromats || [];

  // NOT ONE LAUNDROMAT HAS COORDINATES. The select-list trap, which in this
  // file would refuse every booking in the business. Loud, and fails open.
  const pinned = shops.filter((s) => s.lat != null && s.lng != null);
  if (shops.length && !pinned.length) {
    console.error(
      'SERVICE AREA CANNOT BE CHECKED: not one active laundromat has coordinates. ' +
        'Either none has been geocoded, or lat/lng were left out of the query. ' +
        'Bookings are being accepted without the distance rule until this is fixed.'
    );
    return { ok: true, shop: null, legCents: null, quoted: false, reason: 'unpinned' };
  }

  if (!pinned.length) return { ok: false, reason: 'no_laundromat' };

  // AN ADDRESS NOBODY COULD PLACE IS NOT REFUSED. Bergen uses hyphenated house
  // numbers and free geocoders miss them constantly; silence is not an
  // accusation. The courier is asked anyway below, on the text of the address,
  // which is often the thing that actually works - Uber resolves loosely.
  const near = at ? shortlist(at, pinned, { maxMiles }) : pinned.slice(0, SHORTLIST_SIZE);
  if (!near.length) return { ok: false, reason: 'too_far' };

  const priced = await priceEach(addressOf(customer), near, courier);
  const usable = priced.filter((p) => p.legCents != null);

  if (usable.length) {
    // The cheapest leg. Which laundromat is actually chosen for an ORDER is a
    // bigger question - the wash rate matters too, and `quote.chooseFor()` owns
    // that - but for "can we come at all" the cheapest trip that exists is the
    // answer.
    usable.sort((a, b) => a.legCents - b.legCents);
    return { ok: true, shop: usable[0].shop, legCents: usable[0].legCents, quoted: true };
  }

  // EVERY ONE REFUSED. A real no: the courier will not make any of these trips.
  if (priced.every((p) => p.refused)) {
    return { ok: false, reason: 'courier_refused', detail: priced[0].refused };
  }

  // WE COULD NOT ASK - the courier threw, or there is none configured.
  //
  // FAILS OPEN, ON THE OLD RULE. Refusing every booking in the business because
  // a vendor is having a bad minute is far worse than taking one we later have
  // to ring somebody about. The radius is what it falls back to, which is
  // exactly the behaviour that existed before anybody was asked.
  const withinRadius = near.some((s) => s.straightMiles <= config.courier.maxMiles);

  if (withinRadius || !at) {
    console.warn(
      `Could not reach a courier to check ${customer && customer.city ? customer.city : 'an address'}; ` +
        'accepting it on our own distance estimate.'
    );
    return { ok: true, shop: near[0], legCents: null, quoted: false, reason: 'estimated' };
  }

  return { ok: false, reason: 'too_far' };
}

module.exports = {
  SHORTLIST_MILES,
  SHORTLIST_SIZE,

  inNewJersey,
  shortlist,
  reachable,

  // For the tests, and for a caller that already holds an address.
  addressOf,
  partnerAddress,
};
