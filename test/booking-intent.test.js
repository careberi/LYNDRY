'use strict';

// ---------------------------------------------------------------------------
// BOOKING INTENTS.
//
// Neil's decision lock, 14 September: for online bookings, no payment method
// means no order, while the Booking Intent preserves everything the customer
// already entered.
//
// This reverses a rule CLAUDE.md recorded as deliberate, so a good half of what
// is pinned here is the reversal itself - the order that must not be written,
// the sentence that must not promise a held pickup, and the advertising
// conversion that must not fire at the payment screen.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const bookingIntents = require('../src/core/booking-intents');
const booking = require('../src/core/booking');
const { googleTag } = require('../src/web/layout');

// LINE ENDINGS ARE NORMALISED ON THE WAY IN, and that is not tidiness.
//
// These tests read source and slice it on newlines. Git checks this repo out
// with CRLF on Windows, so endOfFn() looking for a bare LF found nothing, the
// slice ran to the end of the file, and a test that passed on the branch failed
// the moment the same bytes were checked out again after a merge. It would fail
// on any fresh clone, and the failure points at the product code rather than at
// the test, which is the worst kind.
const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split(String.fromCharCode(13) + String.fromCharCode(10))
    .join(String.fromCharCode(10));

// The end of a top-level function: the first line that is just a closing brace.
// Built from a char code because this file is written through a shell heredoc
// and a backslash escape does not survive the trip.
const NL = String.fromCharCode(10);
const endOfFn = (src, at) => {
  const end = src.indexOf(NL + '}' + NL, at);
  // A function we cannot find the end of must fail loudly rather than quietly
  // handing back the rest of the file, which is what made the CRLF bug read as
  // a bug in booking-intents.js.
  assert.notEqual(end, -1, 'could not find the end of the function being checked');
  return end;
};

// --- the shape of an intent -------------------------------------------------

test('a one-off intent lands on the day they picked', () => {
  assert.equal(bookingIntents.firstDateFor({ pickup_date: '2026-09-20' }), '2026-09-20');
});

test('A REPEAT WORKS OUT ITS DAY WITHOUT CREATING A SCHEDULE', () => {
  // The wizard used to create the standing order first, because the schedule is
  // what decides the first pickup's date. That is the early-order mistake one
  // table along: somebody who never finished paying would be left with a weekly
  // arrangement. So the date is derived from a schedule held in memory.
  const date = bookingIntents.firstDateFor({ cadence: 'WEEKLY', weekdays: '2' });
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(`${date}T12:00:00Z`).getUTCDay(), 2);
});

test('the soonest of several weekdays wins', () => {
  const both = bookingIntents.firstDateFor({ cadence: 'WEEKLY', weekdays: '2,5' });
  const tue = bookingIntents.firstDateFor({ cadence: 'WEEKLY', weekdays: '2' });
  const fri = bookingIntents.firstDateFor({ cadence: 'WEEKLY', weekdays: '5' });
  assert.equal(both, tue < fri ? tue : fri);
});

test('a broken repeat is not a repeat, and never crashes', () => {
  assert.equal(bookingIntents.isRepeat({ cadence: 'WEEKLY', weekdays: '' }), false);
  assert.equal(bookingIntents.isRepeat({ cadence: 'NONSENSE', weekdays: '1' }), false);
  assert.equal(bookingIntents.isRepeat(null), false);
  assert.equal(bookingIntents.firstDateFor(null), '');
  assert.deepEqual(bookingIntents.weekdaysOf({ weekdays: '1, 3 ,x,9' }), [1, 3]);
});

// --- what must not happen ---------------------------------------------------

test('THE WIZARD DOES NOT BOOK A PICKUP FOR SOMEBODY WITH NO CARD', () => {
  // The whole decision lock. If bookPickup() is ever reachable before the card
  // check again, an order exists that nothing can bill - the exact state this
  // change removed.
  const src = SRC('routes', 'account.js');
  const at = src.indexOf("router.post('/account/book'");
  assert.notEqual(at, -1);
  const body = src.slice(at);

  const gate = body.indexOf('billing.needsCardOnFile(customer)');
  const book = body.indexOf('recurring.bookAndSchedule(customer');

  assert.notEqual(gate, -1, 'the wizard never checks for a payment method');
  assert.notEqual(book, -1, 'the wizard never books at all');
  assert.ok(gate < book, 'the booking is reachable before the card is checked');
});

test('the no-card branch writes an intent and returns without booking', () => {
  const src = SRC('routes', 'account.js');
  const at = src.indexOf('if (billing.needsCardOnFile(customer)) {');
  assert.notEqual(at, -1);
  const branch = src.slice(at, src.indexOf('\n    }', at));

  assert.ok(branch.includes('bookingIntents.save('), 'nothing is saved for them to come back to');
  assert.ok(branch.includes('booking.checkSlot('), 'nothing validates the day before it is saved');
  assert.ok(!branch.includes('bookPickup'), 'the no-card path still books an order');
});

test('THE CARD SCREEN NO LONGER PROMISES A HELD PICKUP', () => {
  // It said "Your pickup is held. It is confirmed the moment a card is saved."
  // There is no order and no reservation behind that sentence any more, and
  // Neil removed slot holding outright - so it would be a promise about a row
  // that does not exist.
  const src = SRC('routes', 'account.js');
  const at = src.indexOf('function cardStep(');
  const fn = src.slice(at, endOfFn(src, at));

  // THE MARKUP, NOT THE REASONING ABOVE IT. The note explaining why that
  // sentence went quotes the sentence, and a naive search finds its own prose -
  // the same trap payment-methods.test.js works around by stripping comments.
  // Here the markup starts at the template literal, which is a cleaner line to
  // draw: what a customer reads is what is inside it.
  const markup = fn.slice(fn.indexOf('return `'));

  assert.ok(!/pickup is held/i.test(markup), 'the card screen still says the pickup is held');
  assert.match(markup, /payment method is required to confirm/i);
});

test('and it shows the price rule before the button', () => {
  // Neil's spec: the customer is shown $2/lb, $25 minimum and "nothing charged
  // now" BEFORE payment. Through the site tokens, never typed, so the sentence
  // cannot drift from the number that bills them.
  const src = SRC('routes', 'account.js');
  const at = src.indexOf('function cardStep(');
  const body = src.slice(at, endOfFn(src, at));

  assert.ok(body.includes('{{PRICE_PER_LB}}'), 'the price is not shown before payment');
  assert.ok(body.includes('{{MINIMUM}}'), 'the minimum is not shown before payment');
  assert.match(body, /nothing is charged now/i);

  const pounds = body.indexOf('{{PRICE_PER_LB}}');
  const button = body.indexOf('Add payment method');
  assert.ok(pounds < button, 'the price rule is below the button');
});

// --- the advertising split --------------------------------------------------

const ADS = { enabled: true, id: 'AW-1234', leadLabel: 'abc', leadValue: 1, currency: 'USD' };

test('REACHING THE PAYMENT STEP IS NOT A COMPLETED ORDER', () => {
  // Neil's brief: the payment step may be tracked as a checkout start, and the
  // primary conversion waits for a saved card and a real order.
  const tag = googleTag({ checkoutStart: true, ads: ADS });
  assert.ok(tag.includes("gtag('event', 'begin_checkout')"), 'no checkout-start event');
  assert.ok(!tag.includes('transaction_id'), 'the checkout start counts a transaction');
});

test('AND THE CHECKOUT-START EVENT CARRIES NO send_to, WHICH IS THE WHOLE POINT', () => {
  // send_to is what makes an event the Google Ads conversion. Adding it here
  // would quietly restore the behaviour this change removed, and nothing else
  // in the page would look different.
  const tag = googleTag({ checkoutStart: true, ads: ADS });
  const line = tag.split('\n').find((l) => l.includes('begin_checkout')) || '';
  assert.ok(!line.includes('send_to'), 'the checkout start fires the ads conversion');
});

test('the completed-order conversion still fires with the order id', () => {
  const tag = googleTag({ conversionId: '901b3995-f3e9-4f39-9660-c85ba6109eff', ads: ADS });
  assert.ok(tag.includes('transaction_id'));
  assert.ok(!tag.includes('begin_checkout'));
});

test('the wizard counts a checkout start, never the lead, at the card step', () => {
  const src = SRC('routes', 'account.js');
  const at = src.indexOf('if (billing.needsCardOnFile(customer)) {');
  const branch = src.slice(at, src.indexOf('\n    }', at));

  assert.ok(branch.includes('checkoutStart: true'));
  assert.ok(branch.includes('conversionId: null'), 'the card step still names a conversion id');
});

test('and the completed-order conversion is marked when the order is created', () => {
  const src = SRC('routes', 'account.js');
  const at = src.indexOf("router.get('/account/card/done/:token'");
  const route = src.slice(at, src.indexOf("router.get('/account/thanks'", at));
  assert.ok(route.includes('adAttribution.markLead('), 'nothing counts the completed order');
});

// --- where an order is actually created -------------------------------------

test('THE CARD BEING SAVED IS WHAT CREATES THE ORDER, IN THE SHARED PATH', () => {
  // Not in a route. All three doors - the webhook, the texted link's return
  // page and the account's return page - pass through cardWasSaved(), and the
  // customer who closes the browser on Stripe's page only gets their pickup
  // because the webhook reaches the same function.
  const src = SRC('core', 'card-saved.js');
  assert.ok(src.includes('bookingIntents.openFor('), 'it never looks for a checkout');
  assert.ok(src.includes('bookingIntents.convert('), 'it never turns one into an order');
});

test('conversion re-runs the real booking rules rather than trusting the intent', () => {
  const src = SRC('core', 'booking-intents.js');
  const at = src.indexOf('async function convert(');
  const body = src.slice(at, endOfFn(src, at));
  // Through recurring.bookAndSchedule(), which calls bookPickup() itself. One
  // implementation for both doors, so a rule can never apply to one and not
  // the other.
  assert.ok(body.includes('recurring.bookAndSchedule('), 'convert() does not re-validate');
  const helper = SRC('core', 'recurring.js');
  const hat = helper.indexOf('async function bookAndSchedule(');
  assert.notEqual(hat, -1, 'the shared helper does not exist');
  assert.ok(
    helper.slice(hat, endOfFn(helper, hat)).includes('booking.bookPickup('),
    'the shared helper does not go through bookPickup()'
  );
});

test('A REFUSED PICKUP KEEPS THE CARD AND LEAVES THE INTENT OPEN', () => {
  // Neil's rule for the 7:55am case: keep the payment method saved, send them
  // back to choose another time, never create an invalid order. The intent has
  // to stay open or "pick another time" means starting over.
  const src = SRC('core', 'booking-intents.js');
  const at = src.indexOf('async function convert(');
  const body = src.slice(at, endOfFn(src, at));

  const refused = body.indexOf('if (!result.ok)');
  assert.notEqual(refused, -1);

  // The branch, not the rest of the function. complete() lives after it, on the
  // success path, which is exactly where it should be.
  const branch = body.slice(refused, body.indexOf('return result;', refused));
  assert.ok(branch.includes('blocked('), 'a refusal records nothing');
  assert.ok(!branch.includes('complete('), 'a refused booking still completes the intent');
});

test('THE PICKUP IS BOOKED BEFORE ANY SCHEDULE IS CREATED', () => {
  // Neil, 14 September: do not create a standing schedule before the pickup
  // exists. Both doors used to do the opposite, because the schedule is what
  // decides the first date - so a refused booking had to undo an arrangement,
  // and every version of that undo was wrong in its own way.
  const src = SRC('core', 'recurring.js');
  const at = src.indexOf('async function bookAndSchedule(');
  assert.notEqual(at, -1, 'the shared helper does not exist');
  const body = src.slice(at, endOfFn(src, at));

  const booked = body.indexOf('booking.bookPickup(');
  const scheduled = body.indexOf('addSchedule(');
  const refused = body.indexOf('if (!result.ok) return result;');

  assert.ok(booked < scheduled, 'a schedule is still created before the booking');
  assert.ok(refused > booked && refused < scheduled, 'a refusal can still reach addSchedule()');
});

test('SO THERE IS NO UNDO AT ALL, WHICH IS THE POINT', () => {
  // The undo was the dangerous part. recurring.stop(customer) ends EVERY
  // schedule a customer has, so a refused Friday checkout would have cancelled
  // the Tuesday pickup they had had for a month. Deleting by id was not safe
  // either: addSchedule() REUSES an existing row for the same weekday and
  // cadence, including an ended one, so the id handed back can be a row that
  // predates this booking entirely.
  const code = SRC('core', 'recurring.js')
    .split(NL)
    .filter((line) => !/^\s*\/\//.test(line))
    .join(NL);

  const at = code.indexOf('async function bookAndSchedule(');
  const body = code.slice(at, endOfFn(code, at));

  assert.ok(!body.includes('stop('), 'the helper can still end schedules');
  assert.ok(!body.includes('delete('), 'the helper can still delete schedules');
});

test('AND NOTHING ANYWHERE ENDS EVERY SCHEDULE ON A REFUSED BOOKING', () => {
  // The one legitimate caller of stop(customer) is the customer pressing "stop
  // repeating", which is a request to end the lot. Anywhere else it is a
  // refused booking taking an arrangement with it.
  // Code only. The note explaining why this rule exists names the call it is
  // warning about, and a naive count finds its own prose.
  const account = SRC('routes', 'account.js')
    .split(NL)
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join(NL);

  const calls = account.split('recurring.stop(customer)').length - 1;
  assert.equal(calls, 1, 'account.js ends every schedule somewhere other than the stop button');

  const at = account.indexOf('recurring.stop(customer)');
  const before = account.slice(Math.max(0, at - 700), at);
  assert.ok(before.includes('/account/repeat/stop'), 'the one call is not the stop-repeating button');

  const intents = SRC('core', 'booking-intents.js');
  assert.ok(!/recurring\s*\.\s*stop\s*\(/.test(intents), 'convert() can still end every schedule');
});

test('the hard delete helper is gone, not just unused', () => {
  // An unused destructive helper is a loaded gun, and this one could delete a
  // schedule addSchedule() had merely reused.
  const recurring = require('../src/core/recurring');
  assert.equal(recurring.remove, undefined, 'recurring.remove() is still exported');
});

test('a booking that survives but whose repeat fails keeps the order', () => {
  // The pickup is real and the customer is about to be texted about it.
  // Throwing it away because the arrangement behind it did not save is the
  // worse of the two failures.
  const src = SRC('core', 'recurring.js');
  const at = src.indexOf('async function bookAndSchedule(');
  const body = src.slice(at, endOfFn(src, at));
  const caught = body.slice(body.indexOf('} catch (err) {'));
  assert.ok(caught.includes('scheduleFailed'), 'a failed schedule is not reported');
  assert.ok(!caught.includes('cancel'), 'a failed schedule cancels the order');
});

test('and both doors say so rather than swallowing it', () => {
  const account = SRC('routes', 'account.js');
  assert.ok(account.includes('result.scheduleFailed'), 'the wizard ignores a failed repeat');
});

// --- the race the webhook and the return page run every time ----------------

test('THE INTENT IS CLAIMED BEFORE ANYTHING IS CREATED', () => {
  // Stripe redirects the browser the instant a card is saved and the webhook
  // lands seconds behind, so both reach convert() for the same checkout.
  // Without a claim, both pass openFor(), both call bookPickup(), and the
  // customer gets two pickups and two confirmation texts.
  const src = SRC('core', 'booking-intents.js');
  const at = src.indexOf('async function convert(');
  const body = src.slice(at, endOfFn(src, at));

  const claimed = body.indexOf('await claim(intent)');
  const booked = body.indexOf('recurring.bookAndSchedule(');

  assert.notEqual(claimed, -1, 'convert() never claims the intent');
  assert.notEqual(booked, -1, 'convert() never books');
  assert.ok(claimed < booked, 'it books before it claims');
});

test('and the loser of the race does nothing', () => {
  const src = SRC('core', 'booking-intents.js');
  const at = src.indexOf('async function convert(');
  const body = src.slice(at, endOfFn(src, at));
  assert.match(body, /if \(!mine\) return \{ ok: false, reason: 'already_claimed' \}/);
});

test('THE CLAIM IS ONE CONDITIONAL UPDATE, not a read and then a write', () => {
  // Reading claimed_at and then writing it would have the same race one level
  // down. Postgres decides who wins; the loser gets no row back.
  const src = SRC('core', 'booking-intents.js');
  const at = src.indexOf('async function claim(');
  const body = src.slice(at, endOfFn(src, at));

  assert.ok(body.includes('.update('), 'the claim does not write');
  // No read before the write. A select() in here would mean the decision was
  // taken in Node rather than by Postgres, which is the same race one level
  // down: two callers both read "free" and both then claim it.
  assert.ok(!/\.select\(FIELDS\)[\s\S]*\.update\(/.test(body), 'the claim reads before it writes');
  assert.ok(body.includes("is('completed_at', null)"), 'a finished intent could be claimed again');
  assert.ok(body.includes('claimed_at.is.null'), 'a free intent cannot be claimed');
});

test('a claim goes stale, so a dead process cannot lock somebody out for ever', () => {
  const src = SRC('core', 'booking-intents.js');
  const at = src.indexOf('async function claim(');
  const body = src.slice(at, endOfFn(src, at));
  assert.ok(body.includes('claimed_at.lt.'), 'an abandoned claim is never taken over');
  assert.ok(bookingIntents.CLAIM_STALE_SECONDS > 0);
});

test('A REFUSED BOOKING HANDS THE CLAIM BACK, a successful one completes', () => {
  // A refused intent stays open by design - they pick another time and this
  // runs again - so holding its claim would make the retry impossible until it
  // went stale.
  const src = SRC('core', 'booking-intents.js');
  const at = src.indexOf('async function convert(');
  const body = src.slice(at, endOfFn(src, at));

  const refused = body.indexOf('if (!result.ok)');
  const branch = body.slice(refused, body.indexOf('return result;', refused));
  assert.ok(branch.includes('release('), 'a refused booking keeps the claim');

  const after = body.slice(body.indexOf('return result;', refused));
  assert.ok(after.includes('complete(mine, result.order)'), 'a booked intent is never completed');
});

test('and the winner is the only one that texts', () => {
  // "We could not hold that pickup" arriving beside a confirmation for the
  // pickup we just held, from one card save, seconds apart.
  const src = SRC('core', 'card-saved.js');
  assert.ok(
    src.includes("booked.reason === 'already_claimed'"),
    'the loser of the race still writes to the customer'
  );
});

test('claimed_at is selected, which is the trap this codebase keeps falling into', () => {
  // Eighth time would be an unselected claimed_at reading as undefined - which
  // looks exactly like a free intent, so every caller would claim it.
  assert.match(bookingIntents.FIELDS, /claimed_at/);
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '0093_booking_intents.sql'),
    'utf8'
  );
  assert.match(sql, /claimed_at\s+timestamptz/);
});

// --- it is not an order, and nothing may treat it as one --------------------

test('NOTHING HERE TEXTS. The caller owns what the customer hears', () => {
  // Three doors reach convert(), and they owe the customer one message between
  // them rather than three. Same rule orders.transition() follows.
  const src = SRC('core', 'booking-intents.js');
  assert.ok(!/sendAndLog|notify/.test(src), 'booking-intents started sending texts');
});

test('an intent is never a stop, a reminder or a board row', () => {
  // It is a note of what somebody was in the middle of. If any of these ever
  // reads booking_intents, an unfinished checkout is on somebody's round.
  for (const file of ['dispatch.js', 'run.js', 'reminders.js']) {
    const src = SRC('core', file);
    assert.ok(
      !src.includes('booking_intents') && !src.includes('booking-intents'),
      `${file} reads booking intents`
    );
  }
});

test('THE ABANDONED-CHECKOUT CHASE MOVED WITH THE STATE IT READS', () => {
  // card-chase.js looked for an order awaiting collection whose customer had no
  // card. An online customer without a payment method no longer has one, so a
  // sweep that only knows the old shape goes quiet for exactly the people it
  // was written for.
  const src = SRC('core', 'card-chase.js');
  assert.match(src, /bookingIntents\s*\.\s*dueForCardChase\(/, 'the chase never looks at checkouts');
  assert.match(src, /bookingIntents\s*\.\s*stampCardLink\(/, 'a chased checkout is never stamped');
});

test('one chase ever, because the stamp is a column and not a counter', () => {
  const src = SRC('core', 'booking-intents.js');
  const at = src.indexOf('async function dueForCardChase(');
  const body = src.slice(at, endOfFn(src, at));
  assert.ok(body.includes("is('card_link_sent_at', null)"), 'a checkout can be chased twice');
});

// --- ops can still see them -------------------------------------------------

test('UNFINISHED CHECKOUTS ARE VISIBLE TO OPS', () => {
  // Neil: "I do not want unfinished online customers to disappear simply
  // because they are no longer represented as orders." Before this they sat on
  // the board badged AWAITING CARD, which is how anybody knew to ring them.
  const admin = SRC('routes', 'admin.js');
  assert.ok(admin.includes("router.get('/ops/checkouts'"), 'there is no screen');
  assert.ok(admin.includes('bookingIntents.unfinishedCount('), 'the dashboard never counts them');
});

test('the list is a query about the clock, not a stored abandoned flag', () => {
  const src = SRC('core', 'booking-intents.js');
  const at = src.indexOf('async function unfinished(');
  const body = src.slice(at, endOfFn(src, at));
  assert.ok(body.includes("is('completed_at', null)"));
  assert.ok(body.includes('created_at'), 'nothing decides what counts as unfinished');
  assert.ok(!/abandoned/i.test(SRC('core', 'booking-intents.js').replace(/\/\/.*$/gm, '')));
});

test('somebody still typing is not on it', () => {
  assert.ok(bookingIntents.UNFINISHED_AFTER_MINUTES >= 10);
});

// --- the doctrine this has to keep ------------------------------------------

test('THE PREFERENCES ARE NOT COPIED ONTO THE INTENT', () => {
  // They are on the customer row already, written at the address step. A second
  // copy is the thing this codebase refuses everywhere else, and it would be
  // the copy that goes stale.
  const code = SRC('core', 'booking-intents.js')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

  assert.ok(!/water_temp|fabric_softener|address_line1/.test(code.replace(/customers\([^)]*\)/g, '')));
});

test('there is no status column, because open and finished are two timestamps', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '0093_booking_intents.sql'),
    'utf8'
  );
  const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.ok(!/\bstatus\b/.test(body), 'a status column crept in');
  assert.ok(body.includes('completed_at'));
  assert.ok(body.includes('booking_intents_one_open'), 'a customer can hold two open checkouts');
});

test('row level security is on, like every other table here', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '0093_booking_intents.sql'),
    'utf8'
  );
  assert.match(sql, /enable row level security/i);
});

test('CLAUDE.md records the reversal rather than still stating the old rule', () => {
  const claude = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');
  assert.ok(
    claude.includes('AN ONLINE ORDER IS NOT WRITTEN UNTIL A CARD IS SAVED'),
    'CLAUDE.md does not record the new rule'
  );
  assert.ok(
    !/The order is\nstill written \*before\* the card is asked for/.test(claude),
    'CLAUDE.md still states the rule this reverses'
  );
});

test('no slot holding was built, because there are no slots', () => {
  // Neil, 14 September: remove the slot-holding concept entirely, do not build
  // capacity management. Worth pinning - it is the part of the original spec
  // most likely to be re-added by somebody reading it later.
  const src = SRC('core', 'booking-intents.js');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/reserve|hold_until|slot_held|expires_at/i.test(code));
});

// --- the window a customer is shown -----------------------------------------

test('the card screen shows the window bookPickup would give, not a guess', () => {
  const slot = booking.windowFor('2026-09-20', '13:00');
  assert.ok(slot && slot.start, 'windowFor no longer answers, and the card screen depends on it');
});
