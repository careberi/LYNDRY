'use strict';

const db = require('../db');
const orders = require('./orders');
const subscription = require('./subscription');
const billing = require('./billing');
const events = require('./order-events');
const payments = require('../providers/payments');
const { site } = require('../web/site');
const { config } = require('../config');
const wash = require('./wash');
const geocode = require('./geocode');
const settings = require('./settings');
const promotions = require('./promotions');
// Required lazily inside the call rather than here: order-alerts needs
// booking's own whenLine(), so requiring it at the top would be a cycle.
const orderAlerts = require('./order-alerts');

// ---------------------------------------------------------------------------
// The rules for booking a pickup, in one place.
//
// There are two front doors now — a text message and the website — and they
// must agree. If the AI refuses a date the web form would accept, or the web
// form books a second order the AI would have blocked, the database ends up in
// a state neither of them expects.
//
// So neither of them decides anything. Both call bookPickup(), which returns a
// plain result, and each renders that result the way its own medium wants: the
// AI writes a sentence, the website shows a form error.
// ---------------------------------------------------------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formats 2026-08-08 as "Saturday 8 Aug".
//
// Built from the string's own parts on purpose: a date-only string parsed as a
// Date is treated as UTC midnight, which displays as the previous day for
// anyone in New Jersey.
function readableDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dayName = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dayName} ${d} ${MONTHS[m - 1]}`;
}

// Everything about "when" is worked out in the timezone the vans actually
// drive in, not the server's.
//
// This used to be `new Date().toISOString()`, which is UTC. From 8pm New Jersey
// time onward UTC has already rolled over, so a customer texting "pickup today"
// on Tuesday evening was told Tuesday had already passed. Nobody caught it
// because nobody tested after 8pm.
const SERVICE_TZ = 'America/New_York';

const CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: SERVICE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// { date: '2026-08-11', time: '19:45' } — right now, in New Jersey.
function nowInService() {
  const parts = {};
  for (const p of CLOCK.formatToParts(new Date())) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function today() {
  return nowInService().date;
}

// WHAT DAY A PAST MOMENT HAPPENED ON, in the timezone the vans drive in.
//
// nowInService() answers this for right now; this answers it for a stored
// timestamp. Same reason it exists at all: a bag collected at eight in the
// evening has a UTC date of TOMORROW, so comparing ISO strings would call a
// genuine same-day turnaround an overnight one - and only ever in the evening,
// which is exactly the sort of bug nobody reproduces.
function serviceDateOf(instant) {
  if (!instant) return null;
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return null;

  const parts = {};
  for (const p of CLOCK.formatToParts(at)) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// WHAT THE CLOCK SAID IN NEW JERSEY AT A STORED MOMENT, the same shape as
// nowInService(): { date, time }. For anything that asks whether a moment in
// the past fell in quiet hours - the subscription question after a late
// delivery is judged by when the van was at the door, not by when a sweep
// happens to look.
function serviceClockOf(instant) {
  if (!instant) return null;
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return null;

  const parts = {};
  for (const p of CLOCK.formatToParts(at)) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Add days to a date string without ever making a Date out of it.
//
// Date.UTC then getUTCDate is safe here because nothing is being converted
// between zones - it is calendar arithmetic on a plain "2026-08-13".
function addDays(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// How far New Jersey is from UTC at a given instant. Negative, and it changes
// twice a year, which is the whole reason this is worked out rather than
// hardcoded to -4 or -5.
function offsetAt(instant) {
  const parts = {};
  for (const p of CLOCK.formatToParts(instant)) parts[p.type] = p.value;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute)
  );
  return asIfUtc - instant;
}

// "2026-08-14" plus "18:00" in New Jersey, as a real instant in time.
//
// Two passes on purpose. The first guesses the offset from the naive time; on
// the two days a year the clocks move, that guess can be an hour out, and the
// second pass corrects it using the offset that actually applies at the
// instant we landed on.
function instantAt(iso, hhmm) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const [hh, mi] = String(hhmm).split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mi);

  const first = naive - offsetAt(naive);
  return naive - offsetAt(first);
}

// THE MOMENT THE NEXT-DAY PROMISE RUNS OUT: the end of the day, not the end of
// the round.
//
// Neil, 13 September, reading "9h 51m left" on order #2060: "if we have picked
// up the order on day 1, we have the whole day 2 to drop it off, not 24hrs
// after we picked it up, not until we are closed. we have until day 2 is over."
//
// IT USED TO BE THE LAST PICKUP WINDOW, AND THAT WAS AN ASSUMPTION NOBODY MADE
// ON PURPOSE. It read PICKUP_WINDOWS and took the end of the last one - so the
// hours we offer to COLLECT in were quietly deciding when a DELIVERY was late.
// Those are different questions: a customer who gets their laundry back at
// seven in the evening on day two has been given exactly what they were
// promised, and the old figure called it overdue an hour earlier.
//
// The comment here used to say deriving it from the windows meant changing them
// moved the promise, which was true and was the problem. A promise made to a
// customer should not move because the van started finishing earlier.
//
// 23:59 rather than 24:00 because the day is named by its own date; a minute is
// not worth the confusion of a deadline stamped on the day after the one it
// belongs to.
function endOfPromiseDay() {
  return '23:59';
}

// 1st, 2nd, 3rd, 4th … and 11th/12th/13th, which are the ones naive versions
// get wrong.
function ordinal(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

function hasAddress(customer) {
  return Boolean(customer.address_line1 && customer.city && customer.postal_code);
}

// DO WE KNOW WHAT TO CALL THEM.
//
// A real customer typed "Erica Perry, 25 Windham place, Glen rock" and her
// address, town, zip and wash preferences were all saved. Her name was not.
//
// The cause was structure, not a typo. The prompt collects the name FIRST and
// saves everything LAST, in one call after the recap - so the zip, the wash and
// the spot were all asked moments before the save and survived, while the name
// had to live in the model's context through the entire conversation. It did
// not.
//
// AND NOTHING NOTICED, which is the real fault. hasAddress() checks the street,
// the town and the zip; nothing anywhere required a name, so losing one was
// invisible until somebody read the board and saw "Unnamed customer".
//
// So it is required, the same way the zip is. Onboarding asks for a name and an
// address in one breath - if only half of that comes back, the booking waits.
// The prompt asks; this refuses.
function hasName(customer) {
  return Boolean(String(customer.name || '').trim());
}

// AN ANSWER GIVEN AFTER BOOKING HAS TO REACH THE ORDERS ALREADY BOOKED.
//
// Neil, 21 September: book first, ask wash after. bookPickup() snapshots the
// customer's preferences onto the order at booking, and the tag page, the run
// and the reminder all read that snapshot first - so without this a customer
// who answered "hot, no softener" a minute after booking was saved on their
// profile and washed cold with softener, and one who said "actually the side
// gate" was still collected from the front door. The reply said "that's
// updated on order #N" both times, which was not true either time.
//
// | | |
// |---|---|
// | the wash | onto a pickup still WAITING to be collected. Once we hold the bag it may be washed already, so its copy is left alone |
// | the spot | onto a pickup waiting AND onto one in our hands. Where to leave it is open right up until delivery - the same rule actions.js keeps |
//
// ONLY ORDERS WITH A SNAPSHOT. An order booked with no preferences at all
// carries null, and every reader then falls back to the customer's live row -
// which already has the answer. Writing just these keys into that null would
// make it a non-empty snapshot and hide everything else on the profile.
//
// Returns the order numbers it changed and the ones in our hands whose wash it
// left alone, so a reply can say what actually happened. Best effort, and it
// never throws: the answer is saved on the customer already, and a failure
// here is a line in the log and a stale tag.
const SPOT_KEYS = ['special_instructions', 'dropoff_spot'];

async function refreshBookedOrders(customerId, preferences) {
  const done = { changed: [], washHeldBack: [] };
  const prefs = preferences || {};

  try {
    const { data: live, error } = await db
      .from('orders')
      .select('id, order_number, status, preferences')
      .eq('customer_id', customerId)
      .in('status', ['REQUESTED', ...orders.IN_OUR_HANDS]);
    if (error) throw error;

    for (const order of live || []) {
      const was = order.preferences;
      if (!was || !Object.keys(was).length) continue;

      const waiting = order.status === 'REQUESTED';
      const merged = { ...was };

      for (const key of wash.KEYS) {
        if (!wash.isValid(key, prefs[key]) || prefs[key] === was[key]) continue;
        if (waiting) merged[key] = prefs[key];
        else if (!done.washHeldBack.includes(order.order_number)) done.washHeldBack.push(order.order_number);
      }

      for (const key of SPOT_KEYS) {
        const spot = String(prefs[key] || '').trim();
        if (spot) merged[key] = spot;
      }

      const keys = [...wash.KEYS, ...SPOT_KEYS];
      if (keys.every((key) => merged[key] === was[key])) continue;

      const update = { preferences: merged };
      if (waiting) update.surcharge_cents = wash.surchargeFor(merged);

      const { error: updateError } = await db
        .from('orders')
        .update(update)
        .eq('id', order.id)
        .eq('status', order.status);
      if (updateError) throw updateError;

      done.changed.push(order.order_number);

      const said = [];
      if (wash.KEYS.some((key) => merged[key] !== was[key])) said.push(`wash ${wash.describeSaved(merged)}`);
      if (SPOT_KEYS.some((key) => merged[key] !== was[key])) {
        said.push(`spot ${merged.dropoff_spot && merged.dropoff_spot !== merged.special_instructions
          ? `${merged.special_instructions || 'the door'}, back to ${merged.dropoff_spot}`
          : merged.special_instructions}`);
      }
      await events.record(order.id, {
        kind: 'NOTE',
        summary: `Updated from the customer's answer: ${said.join('; ')}`,
      });
    }
  } catch (err) {
    console.error(`Could not copy an answer onto ${customerId}'s booked orders: ${err.message}`);
  }

  return done;
}

// Have they actually told us how to wash their clothes?
//
// IT IS NOT A GATE ON A BOOKING AND HAS NOT BEEN SINCE 16 SEPTEMBER - see the
// long note in bookPickup(). What it answers now is EXPLICIT against DEFAULT:
// true means they chose, false means nobody has said and the wash falls back to
// cold with softener. That is the distinction the intake table draws and it is
// the one that matters here.
//
// WHAT HAS NOT CHANGED: a default is never written into their row, and nobody
// may read one back to them as though they had picked it. "We've set you up
// with cold water and standard detergent" went to a real customer who had
// chosen nothing, and Neil called it unacceptable. Defaulting the WASH is fine;
// telling somebody it is their SETTING is not.
function hasPreferences(customer) {
  const prefs = customer.preferences || {};

  // VALIDATED, NOT MERELY PRESENT. A value we no longer offer - an old
  // HYPOALLERGENIC detergent, or a softener stored as the boolean it used to
  // be - would otherwise satisfy a "is it set" check and then quietly fall back
  // to the default when the wash lines were built. That is somebody's clothes
  // washed a way they did not choose, with nothing anywhere saying so.
  //
  // Failing here just means they are asked again, which is the right outcome.
  return wash.KEYS.every((key) => wash.isValid(key, prefs[key]));
}

// Is this address somewhere the van actually goes?
//
// BERGEN COUNTY, and Neil has now drawn the line that CLAUDE.md said was
// undrawn. It used to be "New Jersey with an 07xxx zip", which is most of the
// north of the state - fine while the promise was "Northern New Jersey" and
// far too wide for one van working out of Fair Lawn.
//
// A ZIP LIST RATHER THAN A CLEVER TEST, because a county has no arithmetic. It
// is long, it is boring, and it is checkable by a person - which matters,
// since being wrong here turns away somebody we could serve.
//
// What this is NOT: proof the address exists. Nothing here checks that
// 16-50 Chandler Dr is a real door; that needs an address validation service
// and is a separate, deliberate decision.
const BERGEN_ZIPS = new Set([
  // South and the Meadowlands edge
  '07010', '07020', '07022', '07024', '07026', '07031',
  '07070', '07071', '07072', '07073', '07074', '07075',
  // North west, up the Ramapo side
  '07401', '07407', '07410', '07417', '07423', '07430', '07432', '07436',
  '07446', '07450', '07452', '07458', '07463', '07481', '07495',
  // Hackensack and the central belt
  '07601', '07603', '07604', '07605', '07606', '07607', '07608',
  // The Northern Valley and the Palisades
  '07620', '07621', '07624', '07626', '07627', '07628', '07630', '07631',
  '07632', '07640', '07641', '07642', '07643', '07644', '07645', '07646',
  '07647', '07648', '07649', '07650', '07652', '07653', '07656', '07657',
  '07660', '07661', '07662', '07663', '07666', '07670', '07675', '07676',
  '07677',
]);

// --- DOES THE TOWN MATCH THE ZIP --------------------------------------------
//
// Neil's ask. inServiceArea() proves a ZIP is in Bergen County and proves
// nothing about the rest of the line: "16-16 Chandler drive, Bergenfield nj
// 07410" went straight in, and 07410 is Fair Lawn.
//
// ONLY THE CONTRADICTION IS CHECKED, never whether the house exists. Bergen
// uses hyphenated house numbers and free geocoders miss them constantly, so
// refusing an unfound door would turn away real customers. A ZIP has exactly
// one town, though, and that is worth checking.
//
// SILENCE IS NOT AN ACCUSATION. If the geocoder is down, slow, or cannot place
// the ZIP, this returns null and the address is accepted - the same rule the
// routing follows. A free service having a bad day must never be able to stop
// somebody becoming a customer.
function sameTown(a, b) {
  const norm = (t) =>
    String(t || '')
      .toLowerCase()
      .replace(/\b(township|twp|borough|boro|village|city|town)\b/g, '')
      .replace(/[^a-z]/g, '');

  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return true;

  // Contains either way, so "Fort Lee" and "Ft Lee" and "Lee" all agree.
  return x === y || x.includes(y) || y.includes(x);
}

async function addressProblem({ city, postal }) {
  const zip = String(postal || '').trim();
  const said = String(city || '').trim();
  if (!zip || !said) return null;

  const real = await geocode.townForZip(zip).catch(() => null);
  if (!real) return null;

  if (sameTown(real, said)) return null;

  return {
    reason: 'town_zip_mismatch',
    said,
    real,
    // Written here rather than left to the AI, because it names a place and a
    // number and both have to be right.
    say:
      `That zip is ${real}, not ${said} - one of them is off. ` +
      `What is the right town and zip?`,
  };
}

// NEIL'S OWN NUMBER, WHICH CAN ALWAYS BOOK.
//
// He has to be able to put an order through while the service is shut and from
// an address outside the county - that is how the thing gets tested end to end
// and how he takes a favour for somebody he knows.
//
// It waives exactly two rules, both of which are decisions about who we choose
// to serve rather than facts a booking needs: the closed sign, and the county
// boundary. An address, wash preferences, a card and a real date are still
// required of him like anybody else, because those are what make an order
// possible to actually do.
function alwaysAllowed(customer) {
  const digits = String((customer || {}).phone || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 && config.alwaysBookNumbers.includes(ten);
}

// --- WHERE WE WORK ----------------------------------------------------------
//
// THE SERVICE AREA IS A FUNCTION OF WHO DOES THE DRIVING, which is why there are
// two answers here rather than one with a flag on it.
//
// Under the van, the round starts in Fair Lawn and "ten miles from a laundromat"
// means nothing - the county is the boundary, and `BERGEN_ZIPS` is it. Under a
// courier, the driving starts at the customer's door and ends at a laundromat,
// so the only thing that decides whether a trip is possible is how far apart
// those two are. `config.courier.model` is what says which world we are in.
//
// NEIL'S RULE, 25 SEPTEMBER, IN TWO PARTS: within ten miles of a laundromat
// wherever that reaches, and "just keep it inside of new jersey and outside of
// new york city".
//
// NEW JERSEY IS WHAT EXCLUDES NEW YORK CITY, and it has to be asked
// affirmatively. The old check read `if (state && state !== 'NJ')`, which passed
// a blank state - harmless against a list of 67 Bergen ZIPs, and not harmless at
// all against a radius, because Manhattan is inside ten miles of both Carlstadt
// and Englewood. Uber refused every Manhattan address tried, but a boundary that
// only holds because a vendor happens to agree with it is not a boundary.
function inNewJersey(customer) {
  const state = String((customer || {}).state || '').trim().toUpperCase();
  if (state) return state === 'NJ';

  // NO STATE ON THE ROW, SO THE ZIP ANSWERS. New Jersey is 07000-08999 and New
  // York City is 10001-11697, so the two cannot be confused - and this needs no
  // list, unlike the county it replaces. A row with neither is not placed, and
  // an unplaced address is not in the area.
  const zip = String((customer || {}).postal_code || '').trim().slice(0, 5);
  return /^0[78]\d{3}$/.test(zip);
}

// WITHIN REACH OF ANY ONE OF THEM, measured as the crow flies.
//
// PURE, AND THE LAUNDROMATS ARE PASSED IN. Which laundromats are active is a
// query and this is a rule, so the caller loads them - the same split the rest of
// this file follows, and what lets the boundary be tested without a database.
//
// AS THE CROW FLIES, NOT BY ROAD. "Within 10 miles" is what somebody means
// looking at a map. The road factor estimates a COST and has no business drawing
// a boundary: multiplying by 1.3 first turned a real Park Ridge address 9.8 miles
// from Glen Rock into 12.7 and put it outside, and Uber then quoted that exact
// trip for $10.99.
function withinReachOf(customer, laundromats, maxMiles = config.courier.maxMiles) {
  const at = (customer || {}).lat != null && (customer || {}).lng != null
    ? { lat: Number(customer.lat), lng: Number(customer.lng) }
    : null;

  // NOT PLACED IS NOT REFUSED, and that direction is deliberate. A customer with
  // no coordinates is one the geocoder could not find - Bergen's hyphenated
  // house numbers defeat it constantly - and a free service having a bad day must
  // never be the reason somebody cannot book. New Jersey still had to be true.
  if (!at) return true;

  // NULL IS "WE COULD NOT ASK" AND `[]` IS "THERE ARE NONE", and the two get
  // opposite answers. A failed query must not read as an empty county: it would
  // refuse every booking in the business, which is the failure this whole
  // function is written around.
  if (laundromats == null) return true;

  const shops = laundromats;
  const pinned = shops.filter((s) => s.lat != null && s.lng != null);

  // NOT ONE LAUNDROMAT HAS COORDINATES, WHICH IS THE ELEVENTH TIME THIS TRAP HAS
  // BEEN SET AND THE FIRST TIME IT COULD CLOSE THE WHOLE BUSINESS.
  //
  // CLAUDE.md records it against `CARD_FIELDS`, `BOARD_FIELDS` and `RUN_FIELDS`:
  // a column left out of a `select` comes back undefined, which is
  // indistinguishable from it being empty. `partners.activeLaundromats()` did not
  // select lat or lng. Handed that list, a loop that simply skipped unpinned
  // shops would find nobody in range and refuse EVERY booking, everywhere, with
  // "outside our area" - and the cause would be two missing words in a query.
  //
  // SO THE TWO CASES ARE SEPARATED. Some shops placed and none near is a real
  // refusal. NONE placed is us being unable to answer, which fails open and says
  // so loudly, because a boundary we cannot compute must not masquerade as one
  // the customer is outside.
  if (shops.length && !pinned.length) {
    console.error(
      'SERVICE AREA CANNOT BE CHECKED: not one active laundromat has coordinates. ' +
        'Either none has been geocoded, or lat/lng were left out of the query. ' +
        'Bookings are being accepted without the distance rule until this is fixed.'
    );
    return true;
  }

  for (const shop of pinned) {
    const miles = geocode.milesBetween(at, { lat: Number(shop.lat), lng: Number(shop.lng) });
    if (miles <= maxMiles) return true;
  }

  // Placed laundromats exist and none of them is within reach. A genuinely
  // out-of-area address, and the one case that should be refused.
  //
  // An EMPTY list is refused too: no laundromat at all means nothing can be
  // washed, and taking a booking we cannot fulfil is worse than turning it down.
  return false;
}

// A ZIP ON ITS OWN, FOR THE ADDRESS STEP, WHERE THERE ARE NO COORDINATES YET.
//
// The account form checks the area as somebody types their address rather than
// waiting for the booking, so that nobody is told twice - the second time after
// picking a day. That check had the whole ZIP list to work with; under the
// courier model it has a radius and needs a point on a map.
//
// SO THE ZIP IS PLACED, ONCE, THROUGH THE SHARED THROTTLE. It costs one lookup
// on a form submission that already makes one for the town/ZIP mismatch check.
//
// AND A ZIP IT CANNOT PLACE IS ACCEPTED. Silence is not an accusation, the rule
// the rest of this file follows: a free geocoder having a bad day must never be
// what stops somebody becoming a customer, and `bookPickup()` checks again
// against the real saved address.
async function zipInServiceArea(zip) {
  const five = String(zip || '').trim().slice(0, 5);

  if (config.courier.model !== 'DYNAMIC') return BERGEN_ZIPS.has(five);

  // NEW JERSEY IS 07000-08999 AND NEW YORK CITY IS 10001-11697, so this is what
  // keeps New York out - Neil, 25 September: "just keep it inside of new jersey
  // and outside of new york city". No list, and nothing to maintain.
  if (!/^0[78]\d{3}$/.test(five)) return false;

  const at = await geocode.lookupOnce(`${five}, NJ, USA`).catch(() => null);
  if (!at) return true;

  // A ZIP IS PLACED AT ITS MIDDLE, AND PEOPLE LIVE AT ITS EDGES, so this check
  // is deliberately looser than the booking one by a whole ZIP's width.
  //
  // IT HAS TO BE LOOSER, NEVER TIGHTER, and the first version was tighter: a
  // real Mahwah address was inside ten miles of the Glen Rock laundromat while
  // 07495's centroid was outside, so the form turned away somebody the booking
  // would have accepted. That is worse than the problem this check exists to
  // solve - being told twice is annoying, being told no wrongly is a lost
  // customer who never finds out we could have come.
  //
  // FIVE MILES COVERS ANY NEW JERSEY ZIP, and Trenton and Atlantic City are
  // forty miles out, so the obviously-far-away case it is actually for still
  // works.
  // THROUGH `withinReachOf`, WITH A WIDER REACH - not a second copy of it. It
  // already knows the three ways this can fail to have an answer (no
  // coordinates, an unreadable table, a list with nothing pinned) and all three
  // apply here identically. Only the distance differs.
  return withinReachOf(
    { lat: at.lat, lng: at.lng },
    await laundromatsForArea(),
    config.courier.maxMiles + ZIP_MARGIN_MILES
  );
}

// How much slack the ZIP-level check gets over the address-level one. See
// zipInServiceArea() for why it is slack and not precision.
const ZIP_MARGIN_MILES = 5;

// WHAT THE BOUNDARY IS, IN WORDS, so no sentence anywhere has to name a county
// the code may not be using. One place to read it from and one place to change.
function serviceAreaWords() {
  if (config.courier.model !== 'DYNAMIC') return 'Bergen County, New Jersey';
  return `New Jersey, within ${config.courier.maxMiles} miles of one of our laundromats`;
}

// The laundromats the boundary is measured from, or an empty list under the van
// model where it is not measured from anything.
//
// LAZILY REQUIRED. `partners.js` does not reach back into this file today, and
// a require loop here would hand `partners` an empty object at boot and make
// every booking out of area - the failure CLAUDE.md records against
// `booking -> order-alerts -> issues -> booking`. This costs nothing and cannot
// do that.
async function laundromatsForArea() {
  if (config.courier.model !== 'DYNAMIC') return [];

  try {
    return await require('./partners').activeLaundromats();
  } catch (err) {
    // FAILS OPEN, LOUDLY. An unreadable partners table is our problem, and
    // refusing every booking in the business over it is the worse of the two
    // failures - `withinReachOf` accepts an unanswerable boundary for the same
    // reason. New Jersey is still checked, because that needs no query.
    console.error(`Could not read the laundromats to check the service area: ${err.message}`);
    return null;
  }
}

// ASYNC, AND IT LOADS THE LAUNDROMATS ITSELF WHEN IT IS NOT GIVEN THEM.
//
// It was synchronous and pure while the answer was a ZIP list. Under the courier
// model it needs to know where the laundromats are, and the alternative was a
// second argument every caller has to remember - where forgetting it would have
// meant a boundary that quietly passed everybody, on the one check that decides
// whether we take work we cannot do. There are four callers and a fifth is
// likely, so the safe version is the one that cannot be called wrongly.
//
// A CALLER THAT ALREADY HAS THE LIST PASSES IT, which is what stops `checkSlot`
// making the same query twice in one booking.
//
// THE PURE HALVES ARE `inNewJersey` AND `withinReachOf`, and that is where the
// rules are tested. Nothing about the boundary itself needs a database.
async function inServiceArea(customer, laundromats = undefined) {
  if (config.courier.model !== 'DYNAMIC') {
    const state = String((customer || {}).state || '').trim().toUpperCase();
    if (state && state !== 'NJ') return false;

    const zip = String((customer || {}).postal_code || '').trim().slice(0, 5);
    return BERGEN_ZIPS.has(zip);
  }

  if (!inNewJersey(customer)) return false;

  const shops = laundromats === undefined ? await laundromatsForArea() : laundromats;
  return withinReachOf(customer, shops);
}

// Returns a human sentence if the date is unusable, or null if it is fine.
function dateProblem(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) {
    return "I didn't catch which day you meant. What day works?";
  }

  // A date the calendar doesn't have — 31 February, say — survives the pattern
  // above but is not a real day.
  const [y, m, d] = iso.split('-').map(Number);
  const asDate = new Date(Date.UTC(y, m - 1, d));
  if (asDate.getUTCMonth() !== m - 1 || asDate.getUTCDate() !== d) {
    return `${MONTHS[m - 1] || 'That month'} doesn't have a ${d}${ordinal(d)}. What day did you mean?`;
  }

  if (iso < today()) {
    return `${readableDate(iso)} has already passed. What day did you mean?`;
  }

  return null;
}

// THE WEEKDAY THEY SAID, AGAINST THE DATE THEY SAID.
//
// "How about Mon sept 18th" - and the 18th was a Friday. The AI turned it into
// 2026-09-18, the code found nothing wrong with a Friday, and she was told
// "Friday 18 Sep works fine" and booked for a day she never asked for. Nobody
// had the two halves of what she said side by side: the model had already
// picked one, and the code only ever saw the date.
//
// So the AI now passes the weekday in the customer's own words and this puts
// the two together. When they disagree the answer is a QUESTION, naming both
// days, and not a booking - because either one could be what they meant and
// there is no undo on a van that turned up on the wrong day. It is the one
// time the AI is allowed to ask which day somebody meant, and the sentence is
// written here so both front doors would ask it the same way.
//
// The other day offered is the nearest date that IS the weekday they named -
// backwards or forwards, whichever is closer, never in the past. People get
// the date right and the weekday wrong about as often as the reverse, so
// both are offered and neither is assumed.
//
// Returns null when they named no weekday, or one this cannot read - a check
// that cannot run is not a mismatch. dateProblem() has already vouched for
// the date itself by the time this is asked.
const DAY_PREFIX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function weekdayIndex(said) {
  const key = String(said || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
  return Object.prototype.hasOwnProperty.call(DAY_PREFIX, key) ? DAY_PREFIX[key] : null;
}

function weekdayMismatch(iso, said) {
  const want = weekdayIndex(said);
  if (want == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;

  const [y, m, d] = iso.split('-').map(Number);
  const got = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (got === want) return null;

  const forward = (want - got + 7) % 7;
  const back = forward - 7;
  let other = addDays(iso, Math.abs(back) < forward ? back : forward);
  if (other < today()) other = addDays(iso, forward);

  return (
    `The ${d}${ordinal(d)} is a ${DAYS[got]}, not a ${DAYS[want]}. ` +
    `Did you mean ${readableDate(other)}, or ${readableDate(iso)}?`
  );
}

// ---------------------------------------------------------------------------
// The pickup windows
// ---------------------------------------------------------------------------
//
// A van cannot be at forty doors at arbitrary minutes, so we do not pretend it
// can. A customer names a time; we put them in the window that contains it and
// tell them the window. We never quote a minute, and we never negotiate.
//
// These are the only place windows are defined: change them here and every
// quote, confirmation and ops screen follows. Existing orders are unaffected,
// because the window they were promised is stored on the order itself rather
// than recomputed - so widening a window never needs a backfill and never
// changes what somebody was already told.
//
// They may be left with gaps between them. A time that falls in a gap gets the
// next window that starts after it.
// Roughly three hours each, and they run back to back from six in the morning
// to nine at night. The width is the point: a van doing a whole county cannot
// promise a half-hour, and a window we miss is worse than a wide one we keep.
//
// They are not all exactly three hours because the day is not shaped that way.
// Midday to two is the short one - it is the lunch gap, and the run tends to be
// thin there. Five to nine is the long one, because it is when most people are
// home, so it takes the most stops and needs the most room.
//
// Six in the morning and nine at night are the outer edges: early enough for
// somebody leaving for work, late enough for somebody getting back from it.
// EVEN TWO-HOUR SLOTS, AND THEY STOP WHERE THE LAUNDROMAT DOES.
//
// Neil asked for two-hour slots, and named seven of them from 6am to 8pm. They
// do not all fit, and the reason is the only laundromat we have: Fancy K is
// open 7:30am to 7pm. A bag collected between 6 and 8pm cannot be dropped off
// before they shut, so it would sit in the van overnight and the next-day
// promise starts a day late. A 6-8am slot has the same problem at the other
// end - nowhere is open to take it.
//
// So the day runs 8am to 6pm: five slots, every one of which can be collected
// AND handed over the same day with time to drive there.
//
// WHEN A SECOND LAUNDROMAT OPENS LATER, THIS IS THE LINE TO CHANGE. It is
// written down rather than derived from partner_hours on purpose - a customer
// is promised a window and it is stored on their order, so windows must not
// silently move because somebody edited a partner's opening times.
const PICKUP_WINDOWS = Object.freeze([
  Object.freeze({ start: '08:00', end: '10:00' }),
  Object.freeze({ start: '10:00', end: '12:00' }),
  Object.freeze({ start: '12:00', end: '14:00' }),
  Object.freeze({ start: '14:00', end: '16:00' }),
  Object.freeze({ start: '16:00', end: '18:00' }),
]);

// A WINDOW CLOSES THE MOMENT IT STARTS. Neil's rule, and it is strict on
// purpose: at 8:01 the 8-10 slot is gone and the earliest is 10-12.
//
// THIS REVERSES WHAT WAS HERE, and the old comment is worth keeping because it
// records the cost. It used to measure against the window's END, so a window
// already underway still took bookings - "today at 4:30", texted at 3:32, went
// into the 3-6 window. Under this rule that same customer gets the next one.
//
// The trade Neil chose: a van cannot be re-routed to a door it has already
// driven past, so a slot that has begun is one we may not be able to keep. A
// window we miss is worse than a later one we hit.
//
// Kept as a constant rather than inlined so the two places that ask - choosing
// a window, and telling the AI which are left - can never disagree about it.
const WINDOW_CLOSES_AT_START = true;

// Where the day starts for somebody who did not name a time. The earliest
// window exists for people who ask for it, not for people who said nothing -
// so this lands in the SECOND slot, 10-12. It moved with the windows: it used
// to be 9am, which fell in the middle of the old 9-12 slot and is now inside
// the first one, which would quietly promise every silent customer an 8am
// knock.
const DEFAULT_FROM = '10:00';

// Accepts what a form sends ("18:00") and what Postgres returns ("18:00:00"),
// and returns a clean "HH:MM" — or null if it is not a time at all.
//
// Deliberately strict: turning free text like "sixish" into a time is the AI's
// job, and it hands us a real clock value. This is the check that the value it
// handed over is genuinely one.
function normaliseTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || '').trim());
  if (!match) return null;

  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 18:00 -> { hour: 6, minute: 0, meridiem: 'pm' }
function clockParts(minutes) {
  const h24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return {
    hour: h24 % 12 === 0 ? 12 : h24 % 12,
    minute,
    meridiem: h24 < 12 ? 'am' : 'pm',
  };
}

// "6", "5:30" — the bare clock reading, no am/pm.
function bareClock(minutes) {
  const { hour, minute } = clockParts(minutes);
  return minute === 0 ? `${hour}` : `${hour}:${String(minute).padStart(2, '0')}`;
}

// "6pm", "5:30am" — for a single time on its own.
function readableTime(value) {
  const clean = normaliseTime(value);
  if (!clean) return null;
  const minutes = toMinutes(clean);
  return `${bareClock(minutes)}${clockParts(minutes).meridiem}`;
}

// "between 3 and 6pm" from a stored window, or from anything window-shaped.
//
// Returns null when there is no window, which is normal: an order booked with
// no time at all simply doesn't mention one.
function describeWindow(startValue, endValue) {
  const from = normaliseTime(startValue);
  const to = normaliseTime(endValue);
  if (!from || !to) return null;

  const startMin = toMinutes(from);
  const endMin = toMinutes(to);
  const a = clockParts(startMin);
  const b = clockParts(endMin);

  // The suffix goes on the end only, unless the window straddles noon and the
  // two halves differ: without that, 11 to 1 reads as "between 11 and 1pm".
  const startLabel =
    a.meridiem === b.meridiem ? bareClock(startMin) : `${bareClock(startMin)}${a.meridiem}`;

  return `between ${startLabel} and ${bareClock(endMin)}${b.meridiem}`;
}

// The window an order was promised. Reads what is stored, never recomputes.
function arrivalWindow(order) {
  if (!order) return null;
  return describeWindow(order.pickup_window_start, order.pickup_window_end);
}

// ---------------------------------------------------------------------------
// Choosing a window
// ---------------------------------------------------------------------------
//
// Given a day, a time somebody asked for, and what time it is now, work out
// which window they get. Returns { date, start, end } or null when there is
// nothing left today and the caller should look at tomorrow.
//
// The rules, in order:
//   - a window that has already started, or starts within the hour, is gone
//   - otherwise the window containing the requested time
//   - otherwise the next window that starts after it
//   - no time asked for at all means the first window still available
function chooseWindow(date, requestedTime) {
  const now = nowInService();
  const isToday = date === now.date;
  const nowMin = toMinutes(now.time);

  const usable = PICKUP_WINDOWS.filter((w) =>
    isToday ? toMinutes(w.start) > nowMin : true
  );

  if (!usable.length) return null;

  // SOMEBODY WHO NAMES NO TIME DOES NOT GET THE FIRST WINDOW OF THE DAY.
  //
  // "Laundry tomorrow" is not a request to be knocked on at six in the morning.
  // The day now opens at 6am for the people who want it, so taking the earliest
  // window as the default would quietly promise every silent customer the one
  // slot almost none of them meant. Default to the first window starting at or
  // after DEFAULT_FROM, and only fall back to the earliest when the day is too
  // far gone for anything else.
  const clean = normaliseTime(requestedTime);
  if (!clean) {
    const sensible = usable.find((w) => toMinutes(w.start) >= toMinutes(DEFAULT_FROM));
    return { date, ...(sensible || usable[0]) };
  }

  const asked = toMinutes(clean);

  // END-EXCLUSIVE, because the windows now run back to back and every boundary
  // belongs to two of them. Somebody who says "noon" means the start of the
  // midday run, not the last minute of the morning one - inclusive matching
  // took the earlier window and quietly promised them a van before they asked
  // for it.
  const containing = usable.find(
    (w) => asked >= toMinutes(w.start) && asked < toMinutes(w.end)
  );
  if (containing) return { date, ...containing };

  // The one time end-exclusive gets wrong: the very last minute of the day.
  // "Nine at night" has no window starting after it, and it is exactly the
  // close of the evening run rather than something later.
  const last = usable[usable.length - 1];
  if (asked === toMinutes(last.end)) return { date, ...last };

  const next = usable.find((w) => toMinutes(w.start) >= asked);
  if (next) return { date, ...next };

  // Asked for a time later than every window, "9pm" say. The closest we can
  // actually do is the last window of the day, which beats throwing them to
  // nine the next morning for being three hours optimistic.
  return { date, ...usable[usable.length - 1] };
}

// The day after an ISO date, without going near a Date object's timezone.
function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + 1));
  return at.toISOString().slice(0, 10);
}

// The window a customer actually gets, rolling to tomorrow when today is done.
// Always returns something, so nothing ever has to ask the customer to pick.
//
// IT ALSO SAYS WHEN IT COULD NOT GIVE THEM WHAT THEY ASKED FOR, and that half
// is the point. A customer texted "update my order to be picked up today at 1"
// at ten past twelve and was told, as settled fact, "no problem at all, we've
// moved it to Wednesday 2 Sep between 2 and 4pm". The window was right - the
// midday run had already started, so 1pm was gone - but nobody had asked them
// whether 2 to 4 suited, and the change was already made by the time they read
// it.
//
// Picking the window is arithmetic and belongs here. Deciding that a DIFFERENT
// time is acceptable belongs to the customer. So this returns both the answer
// and whether the answer is what they asked for, and the caller has to deal
// with the difference rather than papering over it.
function windowFor(date, requestedTime) {
  const asked = normaliseTime(requestedTime);
  const today = chooseWindow(date, requestedTime);

  const window = today || {
    ...chooseWindow(nextDay(date), requestedTime),
    rolledToNextDay: true,
  };

  // No time asked for is not a substitution - there was nothing to substitute.
  // They said "tomorrow" and we picked a sensible window, which is the deal.
  if (!asked) return { ...window, askedFor: null, substituted: false, why: null };

  const askedMin = toMinutes(asked);
  const inside =
    !window.rolledToNextDay &&
    askedMin >= toMinutes(window.start) &&
    askedMin < toMinutes(window.end);

  // The very last minute of the day belongs to the window that ends on it - the
  // same exception chooseWindow makes, and it has to be made in both places or
  // "9pm" reads as a substitution for itself.
  const isCloseOfPlay = !window.rolledToNextDay && askedMin === toMinutes(window.end);

  if (inside || isCloseOfPlay) {
    return { ...window, askedFor: asked, substituted: false, why: null };
  }

  return {
    ...window,
    askedFor: asked,
    substituted: true,
    // Three reasons, and a customer would react differently to each. Rolling
    // to another day is a bigger change than shifting a couple of hours.
    why: window.rolledToNextDay
      ? 'day_full'
      : askedMin < toMinutes(window.start)
        ? 'window_running'
        : 'after_hours',
  };
}

// The refusal, as a sentence somebody would actually say. Written here rather
// than at each call site so the text thread and the website cannot end up
// explaining the same thing two different ways.
//
// IT NAMES THE WINDOW THEY ASKED FOR, not just the time. "Our 12 to 2 run is
// already out" is a reason; "we cannot do 1pm" is a brush-off, and the whole
// point of this sentence is that the customer can see why and decide.
function cannotDoThatTime(window) {
  const offer = describeWindow(window.start, window.end);
  const sameDay = !window.rolledToNextDay && window.date === today();
  const when = sameDay ? 'today' : readableDate(window.date);
  const asked = readableTime(window.askedFor);

  if (window.why === 'day_full') {
    return (
      `${asked} today is not something we can promise - we are done for the ` +
      `day. The next slot is ${when} ${offer}. Does that work?`
    );
  }

  if (window.why === 'after_hours') {
    return `We do not run as late as ${asked}. The closest we can do is ${when} ${offer}. Does that work?`;
  }

  // window_running. Two quite different situations wear the same reason code,
  // and saying the wrong one sounds like we are not paying attention: a run
  // that is out on the road right now, and one that finished this morning.
  const askedMin = toMinutes(window.askedFor);
  const theirs = PICKUP_WINDOWS.find(
    (w) => askedMin >= toMinutes(w.start) && askedMin < toMinutes(w.end)
  );
  const nowMin = toMinutes(nowInService().time);

  const running =
    theirs && nowMin >= toMinutes(theirs.start) && nowMin < toMinutes(theirs.end);

  const reason = running
    ? // "between 12 and 2pm" is how we describe a promise; "12 to 2" is how
      // somebody refers to a run. Same window, different job for the words.
      `our ${describeWindow(theirs.start, theirs.end).replace('between ', '').replace(' and ', ' to ')} run is already out`
    : `${asked} has already gone for today`;

  // The reason is built as a clause so it can be read either way route; this
  // is the whole message, so it gets a capital.
  const opener = reason.charAt(0).toUpperCase() + reason.slice(1);
  return `${opener}, so we cannot get to you then. The next one we can do is ${when} ${offer}. Does that work?`;
}

// WHICH WINDOWS ARE STILL BOOKABLE TODAY, and which have gone.
//
// The AI used to be handed the clock and the full list of windows and asked to
// work out which one a requested time would land in. That is arithmetic, and it
// got it wrong on a real customer: at 11:43 in the morning somebody asked for
// 7am today and the recap read the time straight back to them - "today, 13 Aug
// at 7am" - four hours after it had gone.
//
// So it is computed here and handed over as an answer instead. Same rule as
// everywhere else: the code decides, the AI puts it in a sentence.
function windowsToday(now = nowInService()) {
  const nowMin = toMinutes(now.time);

  const open = [];
  const gone = [];

  for (const w of PICKUP_WINDOWS) {
    // Same test chooseWindow() uses, so the two can never disagree about
    // whether a window is still worth offering.
    if (toMinutes(w.start) > nowMin) open.push(w);
    else gone.push(w);
  }

  const say = (list) =>
    list.map((w) => describeWindow(w.start, w.end).replace('between ', '')).join(', ');

  return {
    open,
    gone,
    openText: say(open),
    goneText: say(gone),
    // What somebody gets if they ask for a time today that has already passed.
    // Null when the day is done and anything they ask for rolls to tomorrow.
    nextText: open.length ? say([open[0]]) : null,
    dayIsDone: open.length === 0,
  };
}

// Every window, as a sentence, for the website and the AI's context.
function listWindows() {
  return PICKUP_WINDOWS.map((w) => describeWindow(w.start, w.end).replace('between ', '')).join(', ');
}

// Returns a human sentence if the time is unusable, or null if it is fine.
//
// A time that has already gone by is NOT a problem any more. It used to ask
// "did you mean tomorrow, or later today?", which reads as arguing with the
// customer about what time it is, and in one real thread the AI asked the
// customer whether 3pm had happened yet. With fixed windows there is nothing
// to argue about: a time that has passed simply lands in the next window, and
// we tell them which one that is.
function timeProblem(value) {
  if (value === undefined || value === null || value === '') return null;

  const clean = normaliseTime(value);
  if (!clean) return "I didn't catch what time you meant. Roughly when works for you?";

  return null;
}

// THE BAG IS ALWAYS LEFT OUT. Neil's call: handing it to the driver was a
// choice on the booking form and in the AI's tools, and it is not a choice we
// actually offer - the whole service is built on nobody having to be home.
//
// The COLUMN keeps both values and so does its CHECK constraint, exactly like
// the fourth sticker on an old bag tag: no order in the database has ever used
// HAND_TO_DRIVER, but a constraint is a sanity bound and this list is the
// business rule. Tightening the database would only make a historical row
// impossible to write back.
const PICKUP_METHODS = ['LEAVE_OUTSIDE'];

// ---------------------------------------------------------------------------
// Book a pickup.
//
// Returns one of:
//   { ok: true, order }
//   { ok: false, reason: 'not_taking_orders', detail }   detail is Neil's reason, or null
//   { ok: false, reason: 'no_address' }
//   { ok: false, reason: 'no_name' }
//   { ok: false, reason: 'bad_date', detail }      detail is a full sentence
//   { ok: false, reason: 'already_booked', order }
//   { ok: false, reason: 'needs_card' }
// ---------------------------------------------------------------------------

// --- CAN WE ACTUALLY DO THIS DAY AND TIME -----------------------------------
//
// Neil's ask, and the right shape: when a customer names a day and a time, the
// answer has to come from the code that knows the rules, not from a model
// reading a prompt and doing date arithmetic.
//
// He was offered tomorrow, four days before the van starts, because the AI
// worked it out for itself and got it wrong. Telling it the rules more firmly
// is not a fix - it is the same gamble with better odds.
//
// THIS IS THE ONE IMPLEMENTATION OF "IS THAT SLOT POSSIBLE". bookPickup() calls
// it and then writes; the AI calls it through check_slot and then speaks. There
// is no second copy to drift, which is the same rule fulfilment.js and
// booking.js already follow for their two front doors.
//
// It writes nothing and is safe to call as often as the conversation needs.
async function checkSlot(customer, { pickupDate, pickupTime, fromSchedule, weekdaySaid } = {}) {
  // NOT TAKING ORDERS. Checked first, before anything else, because when the
  // service is shut every other reason a booking might fail is beside the
  // point - and because this is the guard that has to hold when the AI is
  // talked route. The prompt asks it not to book; this is what makes sure.
  //
  // A STANDING ORDER IS NOT EXEMPT. The nightly job books tomorrow's recurring
  // pickups, and a van that is not running cannot collect them either.
  const owner = alwaysAllowed(customer);

  if (!owner && !(await settings.takingOrders())) {
    return { ok: false, reason: 'not_taking_orders', detail: await settings.pausedReason() };
  }

  if (!hasAddress(customer)) return { ok: false, reason: 'no_address' };
  if (!hasName(customer)) return { ok: false, reason: 'no_name' };

  // Checked at booking rather than only at signup, because an address can be
  // edited later and our range is our range.
  //
  // THE LAUNDROMATS ARE LOADED ONCE AND USED TWICE - here and by the waived
  // list below - because under the courier model the boundary is measured from
  // them. Under the van model this resolves to the ZIP list and the query is
  // never made.
  const shops = await laundromatsForArea();
  if (!owner && !(await inServiceArea(customer, shops))) return { ok: false, reason: 'out_of_area' };

  // WASH PREFERENCES ARE NO LONGER A GATE ON BOOKING, AND THAT REVERSES THE
  // RULE THIS LINE ENFORCED. Neil, 16 September: "Wash prefs after the pickup
  // is booked, not before."
  //
  // The old line read "No preferences, no booking. The AI is told to ask; this
  // is what makes sure, because a model is not a guarantee and a wash nobody
  // specified is not a wash we should run." That reasoning is still right about
  // the WASH. It was wrong about the BOOKING, and Manpreet Singh is why: he
  // asked for a pickup at least four times, and the questions standing between
  // him and a booking - a plan, then water temperature, then softener - were
  // asked while he was trying to say "come now". He never got a pickup.
  //
  // THE ORDER IS NOW: name, address, when, door spot, BOOK, then how to wash
  // it. A booked pickup with the wash still to settle is a phone call or one
  // more text; an unbooked customer is gone.
  //
  // WHAT STILL PROTECTS THE WASH, because the gate was doing a real job:
  // there are still NO DEFAULT PREFERENCES anywhere, nothing invents one, the
  // AI asks for them as the next beat after the booking, the nudge panel lists
  // the gap on the customer and the order, and the laundromat's own page will
  // not show wash instructions it has not been given. What has gone is a
  // refusal to take the order at all.
  //
  // hasPreferences() is untouched and still exported: it is what the nudge and
  // the screens read.

  const detail = dateProblem(pickupDate);
  if (detail) return { ok: false, reason: 'bad_date', detail };

  // A date and a weekday that contradict each other are refused with a
  // question, not resolved by guessing. See weekdayMismatch().
  const clash = weekdayMismatch(pickupDate, weekdaySaid);
  if (clash) return { ok: false, reason: 'bad_date', detail: clash };

  // BEFORE WE OPEN. Not the closed sign - bookings are welcome, the van is
  // simply not running yet.
  //
  // Checked in code and not only in the prompt, for the same reason the closed
  // sign is: a model asked nicely not to book a Saturday will eventually book a
  // Saturday. The owner is exempt, exactly as he is from the closed sign and
  // from the county, because walking a real order through is how this gets
  // tested at all.
  // WHAT THE EXEMPTION LET THROUGH, SAID OUT LOUD.
  //
  // Neil texted "pick up today at 2pm" from his own number to test the opening
  // date and was told "I'd love to grab that for you today" - correct, because
  // SUPPORT_PHONE bypasses it, and indistinguishable from the bug he was
  // looking for. CLAUDE.md already says the exemption's ABSENCE is announced
  // twice because it is otherwise invisible; its PRESENCE has exactly the same
  // problem and cost an afternoon.
  const waived = [];

  if (owner) {
    if (!(await settings.takingOrders())) waived.push('we are not taking orders');

    const opensFor = await settings.opensOn();
    if (opensFor && pickupDate < opensFor) {
      waived.push(`a customer's earliest pickup is ${readableDate(opensFor)}`);
    }

    if (!(await inServiceArea(customer, shops))) waived.push(`that address is outside where we work (${serviceAreaWords()})`);
  }

  if (!owner) {
    const opens = await settings.opensOn();

    if (opens && pickupDate < opens) {
      return {
        ok: false,
        reason: 'before_opening',
        opensOn: opens,
        detail:
          `We start pickups on ${readableDate(opens)}. ` +
          `Happy to get you booked in for then or any day after - which suits?`,
      };
    }
  }

  const timeDetail = timeProblem(pickupTime);
  if (timeDetail) return { ok: false, reason: 'bad_time', detail: timeDetail };

  // ONE PICKUP PER DAY, not one in total.
  //
  // A van makes a single visit to a door on a given day, so a second booking
  // for the same date is a mistake rather than a request. Booking Thursday and
  // Friday is a perfectly ordinary thing to want, and refusing it sent a real
  // customer to a human for something the business plainly wants to say yes to.
  //
  // The database enforces the same rule with a partial unique index; catching
  // it here means the customer gets a sentence instead of a constraint error.
  const existing = await orders.findAwaitingOn(customer.id, pickupDate);
  if (existing) return { ok: false, reason: 'already_booked', order: existing };

  // The order is written BEFORE the card is considered.
  //
  // It used to be the other way route: no card meant no order, so somebody
  // arranging their first pickup got a payment link instead of a booking, and
  // once they had paid there was nothing to resume. They ended up with a saved
  // card and no pickup, which happened to a real customer.
  //
  // So the pickup is recorded first and the card is a separate question asked
  // straight after. A booking with no card on file is simply not confirmed: it
  // exists, it can be resumed the moment a card is saved, and until then it
  // stays off the driver's run sheet, because nobody should drive to a door
  // for an order we have no way to bill.
  // The window is decided here and stored by the caller, never recomputed. If
  // today is done it rolls to tomorrow rather than asking the customer to
  // choose again.
  const window = windowFor(pickupDate, pickupTime);

  // NOBODY IS BOOKED INTO A TIME THEY DID NOT AGREE TO. Same rule as moving an
  // existing pickup, and for the same reason: a window we chose because theirs
  // had gone is a different promise from the one they made, and it needs a yes.
  //
  // A STANDING ORDER IS EXEMPT, and has to be. It was agreed once, weeks ago,
  // and the overnight job that books it has nobody to ask - refusing there
  // would mean a customer with a Tuesday morning arrangement quietly stops
  // being collected the first time the job runs late.
  if (window.substituted && !fromSchedule) {
    return { ok: false, reason: 'time_unavailable', window, say: cannotDoThatTime(window) };
  }

  return { ok: true, window, pickupDate, pickupTime, waived };
}

async function bookPickup(
  customer,
  {
    pickupDate,
    pickupTime,
    pickupMethod,
    bagCount,
    notes,
    fromSchedule,
    // WAS A PERSON SITTING THERE WHEN THIS WAS BOOKED? Nothing else decides
    // whether an admin gets a text about it.
    //
    // IT IS NOT fromSchedule ABOVE, AND CONFUSING THE TWO COST FOUR ORDERS.
    // That one is about the DATE - the day came out of a standing arrangement
    // rather than off somebody choosing it - and it does three other jobs
    // besides: it exempts the pickup from the substituted-window rule, it is
    // written to the order, and it writes the change log. A new customer
    // setting up a monthly pickup on the website is all of that AND somebody
    // placing an order, so for thirteen days those two questions shared one
    // answer and the answer was wrong.
    //
    // FALSE BY DEFAULT, BECAUSE SILENCE IS THE EXPENSIVE FAILURE. Exactly two
    // callers pass true, both sweeps in recurring.js that run with nobody
    // watching. Every other door has a person at it, and a door added later is
    // a person until it says otherwise.
    //
    // THERE IS NOTHING TO DERIVE IT FROM, which is why it is asked for. It is a
    // fact about the CALL, not about the order: the same row is written either
    // way, and placed_via reads WEB both for a wizard booking and for a sweep
    // booking off a wizard-made schedule.
    bookedByTheSystem = false,
    // WHICH SUBSCRIPTION THIS PICKUP BELONGS TO, and therefore what it costs.
    //
    // Null is the ordinary answer and means a one-time pickup at the standard
    // rate. The nightly pass passes the schedule that booked it; the website
    // and the AI pass one only when the customer deliberately chose to put this
    // pickup on their plan.
    //
    // DELIBERATELY NOT DERIVED FROM THE CUSTOMER. Looking up "do they have an
    // active subscription" here and pricing off that would be exactly the rule
    // Neil ruled out: an extra pickup booked by a subscriber is a one-time
    // pickup at $2.00 unless they said otherwise.
    subscriptionId = null,
    // WHICH DOOR THIS CAME THROUGH, recorded on the order rather than only
    // used to pick a greeting. `source` already decides the voice of the
    // confirmation at send time and nothing kept it; "how did this order get
    // here" outlives that sentence, and it is the only way to answer whether
    // taking phone calls is working. Defaults to null rather than THREAD -
    // unknown is honest for a caller that has not been taught to say.
    placedVia = null,
    // The ops user who took the call, as the WHOLE ROW rather than an id.
    // orders.placed_by needs the id and order_events needs the name, and
    // events.record() reads that off by.opsUser - handing it an id alone logs
    // the change against nobody, which is the opposite of the point. PHONE
    // only; there is nobody to name on the other two doors.
    placedBy = null,
  } = {}
) {
  // Every rule lives in checkSlot, so the thing the AI is told and the thing
  // that writes the order can never disagree about what is possible.
  const checked = await checkSlot(customer, { pickupDate, pickupTime, fromSchedule });
  if (!checked.ok) return checked;

  const { window, waived } = checked;

  const prefs = customer.preferences || {};

  const order = await orders.create({
    customerId: customer.id,
    // What they are set up with RIGHT NOW, frozen onto this order. Changing
    // their account later moves the default for next time and leaves this
    // order alone - which is the whole point of storing it here.
    preferences: prefs && Object.keys(prefs).length ? prefs : null,

    // WHAT THE PAID OPTIONS COME TO, frozen at the same moment and for the same
    // reason as the rate. It was never written: the column existed, the pricing
    // read it, and nothing ever put a number in it - so every customer who
    // chose free & clear detergent or fragrance-free softener was told +$2 and
    // charged nothing. A real order, #1932, picked both and paid exactly its
    // weight times the rate.
    surchargeCents: wash.surchargeFor(prefs),
    pickupDate: window.date,
    pickupTime: normaliseTime(pickupTime),
    pickupWindowStart: window.start,
    pickupWindowEnd: window.end,
    // Marks an auto-booked pickup so it can be told apart on the ops board
    // from one somebody actually asked for.
    fromSchedule: Boolean(fromSchedule),
    // And which plan it is priced under, which is a different question - see
    // the note on the parameter.
    subscriptionId: subscriptionId || null,
    // Their saved default, unless they asked for something else this time.
    pickupMethod: PICKUP_METHODS.includes(pickupMethod)
      ? pickupMethod
      : prefs.default_pickup_method || 'LEAVE_OUTSIDE',
    bagCount,
    notes,
    placedVia: DOORS[placedVia] || null,
    placedBy: placedVia === DOORS.PHONE && placedBy ? placedBy.id : null,
  });

  await events.record(order.id, {
    kind: 'CREATED',
    summary: fromSchedule
      ? `Booked automatically from a standing order for ${window.date}`
      : placedVia === DOORS.PHONE
        ? `Booked for ${window.date}, taken over the phone`
        : `Booked for ${window.date}`,
    became: window.date,
    // WHO PLACED IT, and a phone order is the one case where that is neither
    // the customer nor the system: somebody here typed it while they talked.
    // The change log should say so, because "the customer asked for Friday" and
    // "we wrote down Friday" are different claims if the day is ever disputed.
    by:
      fromSchedule
        ? { actor: 'system' }
        : placedVia === DOORS.PHONE && placedBy
          ? { opsUser: placedBy }
          : { actor: 'customer' },
    reason: window.date !== pickupDate ? `Asked for ${pickupDate}, rolled to the next slot` : null,
  });

  // WHERE IT IS GOING, DECIDED NOW. Neil's call: the system should have the
  // address the moment the order is placed, rather than working it out again
  // every time somebody draws a board - which meant a driver looking at
  // tomorrow's route saw a stop called "a laundromat" with no address on it.
  //
  // Deliberately NOT awaited, and deliberately unable to fail the booking. It
  // may geocode, which is a rate-limited public service, and a customer waiting
  // on a confirmation text must never wait on it. If it does not land, the
  // boards still choose live exactly as they always did - this only means the
  // answer is already there.
  //
  // require() here rather than at the top: dispatch requires this file, so a
  // module-level import would be a cycle. Node caches it, so the cost is one
  // lookup.
  require('./dispatch')
    .savePlannedPartner(order, customer)
    .catch((err) => console.error(`Could not plan a laundromat: ${err.message}`));

  // NO MONEY MOVES HERE. The card is charged once, at the door. All this asks
  // is whether we have a card to charge when we get there.
  //
  // `rolled` is whether we had to move them off the day they asked for. Not a
  // failure and not worth arguing about, but worth one clause in the
  // confirmation: a customer who says "today" and silently gets tomorrow
  // writes back to ask why, which is a conversation nobody needed to have.
  // THE ORDER IS THE RECORD NOW, so the note about what they asked for goes.
  // Leaving it would have the prompt insisting on a day they have already been
  // booked for, long after they moved it.
  await db
    .from('customers')
    .update({ pending_pickup: null })
    .eq('id', customer.id)
    .then(({ error }) => {
      if (error) console.error(`Could not clear the asked-for slot: ${error.message}`);
    });

  // THE FREE SLOT IS TAKEN HERE, WHILE THE CUSTOMER IS STILL ASKING.
  //
  // "The first 20 orders are free" runs out, and the only fair moment to find
  // out whether you were in time is the moment you book - not two days later
  // when the price text arrives. So a capped promotion reserves its slot
  // against this order now, and discountFor() honours that reservation at the
  // weigh-in rather than deciding again.
  //
  // AWAITED, unlike the laundromat lookup above, because the confirmation this
  // customer is about to be sent says either "nothing to pay" or "$2.00 a
  // pound", and getting that wrong is the whole thing this avoids. It is one
  // indexed query and an update.
  //
  // A failure must never fail the booking: the pickup is real either way, and
  // the worst case is a customer who was entitled to a free order being quoted
  // the normal price - which is a conversation, not a broken order.
  const claimed = await promotions
    .claimSlot(customer.id, order.id)
    .catch((err) => {
      console.error(`Could not claim a promotion slot for order ${order.id}: ${err.message}`);
      return null;
    });

  // ---------------------------------------------------------------------
  // THE $25 HOLD, AND IT IS WHAT CONFIRMS THE PICKUP.
  //
  // Neil, 14 September: the card must accept a $25 hold before a pickup is
  // confirmed. Money held, not taken - what it buys is the trip, because a van
  // leaving with a driver in it costs the same whether or not there is a bag on
  // the step.
  //
  // AFTER THE ORDER EXISTS, like everything else about money here. CLAUDE.md is
  // emphatic: the order is written first and the card asked about second,
  // because a customer sent away to sort a card out before their booking exists
  // comes back to nothing. That happened to a real one.
  //
  // AFTER THE PROMOTION SLOT, TOO, and that ordering is the substantive one. A
  // free order is told "nothing to pay" in the very next message; holding $25
  // on that card is the contradiction the waived rule exists to prevent, and
  // claimSlot() above is the only thing that knows whether this is one.
  //
  // A REFUSAL IS NOT A FAILED BOOKING. The order is real and stays on the
  // board; what it does not get is a confirmation, because collectable() will
  // keep it off the round until a card accepts the hold. Saving one places a
  // fresh hold and confirms it, which is the same shape as AWAITING CARD.
  const free = promotions.takesEverythingOff(claimed);

  // AND ONLY IF THE PICKUP IS A DAY AWAY. Neil, 14 September: only place the
  // $25 on a booking a day in advance.
  //
  // A hold is a pending line on somebody's card, so a pickup booked a fortnight
  // out would tie up real money for a fortnight - and Stripe would have expired
  // it before the driver arrived, so it would buy nothing in return. Anything
  // further out is held by the night-before pass instead, which is the last
  // honest moment to find out and the first moment it is worth holding.
  //
  // A deferred hold is UNASKED, not refused, so the pickup is confirmed and
  // collectable exactly as it was before any of this existed - and the
  // confirmation says nothing about a hold, because it reads the order and
  // there is not one.
  const hold = free || !billing.holdDueNow(order)
    ? { ok: true, skipped: free ? 'free_order' : 'too_far_out' }
    : await billing.authorizeShowUp(order, customer).catch((err) => {
        // FAILS OPEN, like every other lookup that stands between a customer
        // and a booking. Stripe being unreachable must not turn a good card
        // into a refusal - that would park the pickup with nothing anybody here
        // could do about it. The order books unheld, exactly as it did before
        // this existed, and showUpState() reads UNASKED.
        console.error(`Could not hold the show-up charge for ${order.id}: ${err.message}`);
        return { ok: true, skipped: 'hold_errored' };
      });

  // Merged onto the order we already hold so the confirmation can name the
  // hold without a second query - and so it is READ off the order rather than
  // passed along beside it, which is what keeps the webhook's confirmation and
  // this one saying the same thing.
  if (hold.held) {
    order.authorization_intent_id = hold.paymentIntentId;
    order.authorized_cents = hold.amountCents;
    order.authorized_at = new Date().toISOString();
  }

  // ---------------------------------------------------------------------
  // TELL THE OFFICE. Neil's ask: an admin should get a text when somebody
  // places an order, rather than finding out by opening the board.
  //
  // HERE, not in the two routes, because this function is the one door both
  // front doors go through - the AI's create_order and the website form. A
  // third door added later gets the alert for free; two copies in two routes
  // would not.
  //
  // NOT AWAITED, and that is deliberate. The customer is waiting on a
  // confirmation and an admin's text is not worth a second of that wait. It
  // swallows its own errors, so nothing here can fail a booking that has
  // already been written.
  // ---------------------------------------------------------------------
  orderAlerts
    .newOrder({
      customer,
      order,
      booking: module.exports,
      needsCard: billing.needsCardOnFile(customer),
      freeOrder: promotions.takesEverythingOff(claimed),
      // Whether a PERSON placed it, not whether the date came off a plan. The
      // first pickup of a subscription somebody is setting up on the website is
      // both, and handing the alert that second question is what made #2079
      // silent.
      bookedByTheSystem,
    })
    .catch((err) => console.error(`Order alert threw: ${err.message}`));

  return {
    ok: true,
    order,
    rolled: window.date !== pickupDate,
    // Only a promotion that takes EVERYTHING off may be described as free. A
    // capped 30% offer claims a slot in exactly the same way and must not be
    // announced with "nothing to pay".
    freeOrder: promotions.takesEverythingOff(claimed),

    // HOW MUCH OF IT IS FREE, in pounds, or null for no ceiling.
    //
    // This is the number the confirmation cannot do without. The booking
    // happens before anybody has seen the laundry, so "nothing to pay" is a
    // promise made in ignorance of the weight - true for a bin bag, false for
    // somebody's spring clean, and found out two days later in the price text.
    // Saying the allowance at booking is what stops that being an argument.
    freeUpToLb: promotions.freeAllowanceLb(claimed),
    needsCard: billing.needsCardOnFile(customer),

    // WHETHER THE CARD CONFIRMED IT. `holdRefused` is the one a caller must
    // act on: it means a card is on file, it was asked for the hold, and it
    // said no - so there is an order and no confirmation to send.
    heldCents: hold.held ? hold.amountCents : null,
    holdRefused: Boolean(hold.refused),
    holdReason: hold.reason || null,

    // Empty unless somebody has deliberately set ALWAYS_BOOK_NUMBERS. It is
    // kept because the day that list comes back, the silence comes back with
    // it - and that is what made a working exemption look like a broken rule.
    waived,
  };
}

// ---------------------------------------------------------------------------
// Describing a booking back to the customer
// ---------------------------------------------------------------------------
//
// These live here, next to the rules, because BOTH front doors send them and
// the messages table is meant to be the single record of what a customer was
// told. When the AI and the web form each had their own copy, booking by text
// and booking on the site produced two subtly different confirmations for the
// same thing — and only one of them ever got updated.

// THE CARD WOULD NOT ACCEPT THE HOLD, SO THERE IS NO CONFIRMATION TO SEND.
//
// It lives here beside confirmationMessage() for the same reason that one does:
// both front doors reach it, and the day they each wrote their own copy is the
// day booking by text and booking on the site started saying different things
// about the same event.
//
// WHAT IT MUST NOT DO is read as "we don't have a card". They gave us one - it
// is on file and it is named in this message - and being told otherwise sends
// somebody looking for a problem that is not there. It also says nothing has
// been taken, because a refused hold on a statement is a pending line that
// disappears, and a customer who has just seen one is owed that sentence.
function holdRefusedMessage(customer, order, { setupUrl = null, heldCents = null } = {}) {
  const card = billing.describeCard(customer) || 'card';
  const amount = billing.money(heldCents == null ? billing.showUpCents() : heldCents);

  // IT ENDS ON THE DESTINATION, because cardDestination() returns the tail of a
  // sentence and one of its two answers already ends in a full stop. Anything
  // appended after it reads as a sentence running into the next one.
  return (
    `We couldn't confirm order #${order.order_number} for ${whenLine(order)}: your ${card} ` +
    `wouldn't accept the ${amount} hold we place before a pickup. Nothing has been taken, ` +
    `and we'll book you straight in once it goes through. ` +
    `Update it ${billing.cardDestination(order, setupUrl)}`
  );
}

// "Wednesday 12 Aug between 5:30 and 7pm", or just the day when no time was
// asked for.
function whenLine(order) {
  const day = readableDate(order.pickup_date);
  const window = arrivalWindow(order);
  return window ? `${day} ${window}` : day;
}

// The text sent when a pickup is booked, whichever door it came through.
//
// Naming the card here is load-bearing: this message is the authorisation for
// the charge that follows, so if an order is ever disputed the message log
// shows the customer being told which card, before any work was done.
// ---------------------------------------------------------------------------
// WHICH DOOR THE ORDER CAME THROUGH DECIDES THE VOICE OF THE TEXT.
//
// Neil, reading a confirmation for an order he had placed on the website:
// "there should have never been an 'of course'".
//
// He is right, and it is not a wording preference. "Of course!" is an ANSWER.
// Over text it is exactly right: they asked for a pickup, we said of course.
// On the website nobody said anything - they filled in a form and pressed a
// button - so a text that opens by agreeing is answering a question that was
// never asked. It is the tell that nothing on the other end read anything.
//
// THREAD is the default because the AI is the caller that must never have to
// remember, and its replies are always answers. WEB is passed by the two
// routes in src/routes/account.js.
//
// The message is otherwise IDENTICAL from both doors, which is the whole
// point of it living here: what a customer is told about their order cannot
// depend on where they typed it. Only the opening clause knows.
// ---------------------------------------------------------------------------
// WHICH DOOR THE ORDER CAME THROUGH, which decides the voice of its text.
//
// THREAD is the default because the AI is the caller that must never have to
// remember. WEB says nothing at the front, because on a form nobody asked us
// anything and a text that opens by agreeing is answering a question that was
// never put.
//
// PHONE is Neil taking a call, added 10 September. They DID ask, out loud, and
// they put the phone down thirty seconds ago - so "Of course!" is nearly right
// and still slightly wrong, because it answers a message rather than a call.
// Thanking them for ringing is the sentence a person would actually write.
const DOORS = Object.freeze({ THREAD: 'THREAD', WEB: 'WEB', PHONE: 'PHONE' });

function confirmationMessage(
  customer,
  order,
  { rolled = false, opener = null, source = DOORS.THREAD, freeOrder = false, freeUpToLb = null } = {}
) {
  const prefs = customer.preferences || {};

  // Where the bag changes hands, BOTH WAYS.
  //
  // Dropoff is not asked for as a separate question. The spot they named for
  // pickup is where it comes back, stated plainly here so they can correct it
  // if they want somewhere else. A fourth setup question to collect something
  // that is the same answer 95% of the time is friction for nothing.
  const pickupSpot = (prefs.special_instructions || '').trim();
  const dropoffSpot = (prefs.dropoff_spot || '').trim();

  let handover;
  if (order.pickup_method === 'HAND_TO_DRIVER') {
    // Only reachable for an order written before the option was removed.
    handover = `We'll knock when we arrive, and again when we bring it back.`;
  } else if (dropoffSpot && dropoffSpot !== pickupSpot) {
    handover =
      `Leave the bag ${pickupSpot ? `at the ${pickupSpot}` : 'outside your door'}, ` +
      `and we'll drop it back at the ${dropoffSpot}.`;
  } else if (pickupSpot) {
    handover = `Leave the bag at the ${pickupSpot}, and that's where we'll bring it back.`;
  } else {
    handover = `Leave the bag outside your door, and that's where we'll bring it back.`;
  }

  // Their wash, as they chose it. Drops out entirely if somehow unset.
  //
  // THROUGH wash.js, NOT AGAINST VALUES TYPED OUT HERE. This read
  // detergent === 'HYPOALLERGENIC', which has not been a value since the paid
  // options went in - so somebody who chose FREE_CLEAR was told in writing
  // they were getting "standard detergent", while being charged $2 extra for
  // the one they actually picked. And fabric_softener is a string now, so
  // 'NONE' was truthy and read back as "softener on": the exact opposite of
  // what they asked for, in the one message that is the record of the order.
  // NOT `const wash`. That shadowed the module-level require for the whole
  // function and then referenced itself inside its own initialiser, so every
  // confirmation for a customer WITH preferences threw before it could be sent
  // - and only for those customers, because the ternary short-circuits when
  // water_temp is unset. The people who got a confirmation were the ones who
  // had not chosen anything.
  //
  // ONLY WHAT THEY CHOSE. This read `prefs.water_temp`, so a customer with a
  // temperature and nothing else - or a value we no longer offer - had the
  // rest filled in from our defaults and read back to them as their order.
  // Neil's locked rule, 21 September: a default is a placeholder, never the
  // customer's answer. hasPreferences() is the test the intake table uses to
  // draw EXPLICIT against DEFAULT, so this and that screen cannot disagree.
  const washLine = hasPreferences(customer) ? ` ${wash.describeSaved(prefs)}.` : '';

  // The price, and WHEN it gets taken. Stated as something that has not
  // happened yet, because it has not: no money moves until the bag is weighed.
  //
  // "once we weigh it" is the load-bearing half of this sentence. Without it a
  // customer reasonably reads "charged to your Visa" as "already charged", and
  // then reads the weigh text an hour later as a second bill.
  const card = billing.describeCard(customer);
  const minimum = billing.money(config.pricing.minimumCents);

  // READ OFF THE ORDER, never passed in. Both doors send this message and so
  // does the card-saved webhook, and a flag three callers have to remember is
  // a flag one of them will forget - which is how the same booking would be
  // described two different ways depending on which door it came through.
  const held = billing.showUpHold(order);
  const heldCents = held ? held.cents : 0;

  // A FREE ORDER REPLACES THE PRICE SENTENCE, it does not add to it. Telling
  // somebody their order is free and then, in the same breath, that we will
  // take $2.00 a pound off their Visa is worse than saying nothing - and this
  // message is already 454 characters against the 459 that three segments hold,
  // so there is no room to say both anyway.
  //
  // It still says the card is on file, because it is, and because the next
  // order will not be free.
  // AND WHEN THE FREE ORDER HAS A CEILING, THE CEILING IS IN THE SENTENCE.
  //
  // "Nothing to pay" was true while the offer was uncapped and became a lie the
  // moment it was capped at 30 lb - and it is said at BOOKING, before anybody
  // has seen the laundry. A customer told their order was free and then billed
  // $40 two days later has been misled, whatever the small print said.
  //
  // The allowance comes from the promotion rather than the sentence, so the day
  // the cap moves this moves with it.
  // WHAT THIS PICKUP ACTUALLY COSTS, READ OFF THE ORDER.
  //
  // It quoted site.pricePerLb, which is the ONE-TIME rate - so a subscriber
  // would have been told $2.00 in the confirmation and charged $1.80 at the
  // door. Telling somebody a higher price than you take is a better direction
  // to be wrong in than the reverse, and it is still wrong.
  //
  // Off the order rather than off the plan, because the order is what was sold:
  // a pickup booked under a subscription that is cancelled tomorrow keeps this
  // figure, which is the whole of Neil's rule about never repricing.
  //
  // COSTS NOTHING IN LENGTH. "$1.80" and "$2.00" are the same five characters,
  // and this message sits at 454 against the 459 that three segments hold.
  const perPound = subscription.perPound(order.price_per_lb_cents || config.pricing.perPoundCents);

  const money = freeOrder
    ? freeUpToLb
      ? ` This one is on us up to ${freeUpToLb} lb - anything over that is ${perPound}, and we'll text you the total after we weigh it.`
      : ` This one is on us - you got one of the free ones, so there is nothing to pay.`
    : card && heldCents
      ? // THE HOLD IS SAID, and it is not optional politeness: a $25 pending
        // charge appearing on somebody's statement with nothing explaining it
        // is a phone call at best and a chargeback at worst. Kept to one clause
        // because this message is already at its segment ceiling.
        ` It's ${perPound} with a ${minimum} minimum. We hold ${billing.money(heldCents)} on your ${card} to confirm, and take the real total off it at your door.`
    : card
    ? ` It's ${perPound} with a ${minimum} minimum. We weigh it after pickup, text you the total, and take it off your ${card} then.`
    : ` It's ${perPound} with a ${minimum} minimum. We weigh it after pickup and text you the total before anything is taken.`;

  const address = customer.address_line1 ? ` at ${customer.address_line1}` : '';

  // "Today's routes are done" is a fact about the van, not a negotiation.
  //
  // `opener` still wins over both, because it is not a greeting: it is the
  // payment webhook saying "Card saved" so the card is not named twice in one
  // text, which a real customer got. That is true whichever door they used.
  const greeting = opener
    ? `${opener}! `
    : source === DOORS.WEB
      ? ''
      : source === DOORS.PHONE
        ? 'Thanks for calling! '
        : 'Of course! ';

  const lead = rolled
    ? `${greeting}Today's routes are finished, so order #${order.order_number} is in for the earliest we can do:`
    : `${greeting}Order #${order.order_number} is booked:`;

  // THE CONFIRMATION IS THE ONE COMPLETE DOCUMENT of the order: number, day
  // and window, address, handover, wash, money, turnaround. Every later text
  // in the order's life says only the one new thing that just happened - a
  // real thread said "24 hours" three times and the total four, and Neil
  // called it out. This is the only message allowed to say everything.
  // WHAT TO PUT IT IN, which nobody was telling them.
  //
  // Neil's point: it comes back in the laundromat's own plastic bag, so the bag
  // they hand over does not have to be anything in particular - a trash bag is
  // genuinely fine, and somebody who does not know that will go and buy one.
  // Anything reusable comes back with the laundry; a disposable one does not,
  // and that is worth saying before somebody sends out a bag they wanted.
  //
  // It fits. The confirmation is 345 characters and a segment is 153, so three
  // segments hold 459 - this lands at 454. The two longer wordings I tried both
  // spilled into a fourth, which is a third more cost on every booking to say
  // the same thing.
  const bag = ` Put it in any bag, even a trash bag - it comes back in a fresh plastic bag, and we return anything reusable.`;

  return (
    `${lead} pickup ${whenLine(order)}${address}. ${handover}${washLine}${money}${bag} ` +
    `Back with you the ${site.turnaround}.`
  );
}
// Same rule. "No problem at all" answers somebody who asked to move it; on
// the website they moved it themselves and there was no problem to have.
function rescheduledMessage(order, { source = DOORS.THREAD } = {}) {
  return source === DOORS.WEB
    ? `Your pickup has moved to ${whenLine(order)}.`
    : `No problem at all, we've moved it to ${whenLine(order)}.`;
}

module.exports = {
  DOORS,
  BERGEN_ZIPS,
  SERVICE_TZ,
  addDays,
  instantAt,
  endOfPromiseDay,
  PICKUP_WINDOWS,
  windowFor,
  cannotDoThatTime,
  describeWindow,
  listWindows,
  windowsToday,
  bookPickup,
  whenLine,
  confirmationMessage,
  holdRefusedMessage,
  rescheduledMessage,
  dateProblem,
  weekdayMismatch,
  timeProblem,
  hasAddress,
  hasName,
  hasPreferences,
  refreshBookedOrders,
  inServiceArea,
  zipInServiceArea,
  inNewJersey,
  withinReachOf,
  serviceAreaWords,
  addressProblem,
  sameTown,
  alwaysAllowed,
  checkSlot,
  readableDate,
  readableTime,
  arrivalWindow,
  normaliseTime,
  today,
  serviceDateOf,
  serviceClockOf,
  nowInService,
  PICKUP_METHODS,
};
