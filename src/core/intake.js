'use strict';

const booking = require('./booking');
const billing = require('./billing');
const orders = require('./orders');
const settings = require('./settings');
const notify = require('./notify');
const wash = require('./wash');
const subscription = require('./subscription');
const recurring = require('./recurring');
const format = require('./format');
const db = require('../db');
const { site } = require('../web/site');

// ---------------------------------------------------------------------------
// WHAT LYNDRY ACTUALLY KNOWS ABOUT THIS CUSTOMER, EVERY FIELD, ALL THE TIME.
//
// Neil's brief, 16 September. This REPLACES the "what is still missing" cards
// in src/web/nudge-panel.js, and the replacement is a change of model rather
// than of styling:
//
//   the old question   what is missing, so I can ask for it
//   the new question   what do we know, where did it come from, and what is
//                      actually stopping the next pickup
//
// THE CORE RULE, IN HIS WORDS: "Not explicitly supplied does not automatically
// mean missing." Four states, and three of them are fine:
//
//   EXPLICIT   they told us
//   DEFAULT    we have a safe business default and can proceed
//   MISSING    genuinely needed before the relevant workflow can move
//   NA         does not apply to this customer
//
// So "Cold - Default" is a perfectly valid state and is not a warning. The old
// cards had no way to say that: anything unanswered was a gap with a button on
// it, which turned every optional preference into something that looked like a
// problem, and hid the two or three that really were.
//
// NOTHING HERE IS STORED, and that is the same rule the nudges kept. He
// described these as stages an order moves through and they are not - a stored
// "intake stage" is a second copy of facts the database already holds, free to
// disagree with them the first time anybody edits a customer by hand. Every row
// below is DERIVED from the customer, the order, the subscription and the
// payment state, every time it is drawn. The table is a projection of the
// system, never another copy of it.
//
// WHICH IS ALSO WHAT MAKES EXPLICIT AND DEFAULT DISTINGUISHABLE AT ALL. A
// default is never written into the customer's row - wash.choiceFor() falls
// back at read time - so a null water_temp still means "nobody has said", which
// is exactly the distinction Neil asks for in his rule 21. The day anything
// starts writing COLD into that column on signup, this table starts lying.
//
// THE ONE THING THAT IS WRITTEN IS `messages.asked_for`, and it has to be. See
// `asked` below.
// ---------------------------------------------------------------------------

const STATES = Object.freeze({
  EXPLICIT: 'EXPLICIT',
  DEFAULT: 'DEFAULT',
  MISSING: 'MISSING',
  NA: 'NA',
});

// WHAT A FIELD IS NEEDED FOR, which is three different questions and used to be
// one. `blocks: true` on the old cards meant "bookPickup() refuses without it",
// and wash preferences carried it wrongly for weeks after that stopped being
// true.
//
//   BOOKING    no pickup can be created without it
//   PICKUP     needed to create THIS pickup, and its absence is the ordinary
//              resting state of a customer between orders
//   DISPATCH   the pickup exists; this is what stands between it and a van
//   null       useful personalisation, never a reason to lose the booking
const NEEDED = Object.freeze({
  BOOKING: 'BOOKING',
  PICKUP: 'PICKUP',
  DISPATCH: 'DISPATCH',
});

// --- the words --------------------------------------------------------------

// "Hi Sarah, it's LYNDRY." or "Hi, it's LYNDRY." - never "Hi , it's".
function greet(customer) {
  const first = String((customer || {}).name || '')
    .trim()
    .split(/\s+/)[0];

  return first ? `Hi ${first}, it's ${site.name}.` : `Hi, it's ${site.name}.`;
}

function firstName(customer) {
  return (
    String((customer || {}).name || '')
      .trim()
      .split(/\s+/)[0] || ''
  );
}

// The address a person reads, on one line. Storage is five columns; the table
// is one row, because that is how a customer thinks about it.
function addressLine(customer) {
  const c = customer || {};
  const street = [c.address_line1, c.address_line2].filter(Boolean).join(' ');
  const town = [c.city, c.state].filter(Boolean).join(', ');

  return [street, town, c.postal_code].filter(Boolean).join(', ').trim();
}

// --- the fields -------------------------------------------------------------
//
// Ten rows, in the order Neil listed them, which is also roughly the order a
// conversation goes in. Each one answers four questions and nothing else: what
// is the value, what state is it in, what may I ask for, and what would that
// message say.

const FIELDS = [
  {
    key: 'name',
    label: 'Name',
    needed: NEEDED.BOOKING,
    read: (c) => ({
      value: String(c.name || '').trim() || null,
      state: booking.hasName(c) ? STATES.EXPLICIT : STATES.MISSING,
    }),
    ask: 'Request Name',
    update: 'Request Update',
    // TWO SENTENCES FOR ONE FIELD, because asking a stranger their name and
    // asking a customer to correct the one we have are different acts. Neil
    // wrote both.
    text: (c) =>
      booking.hasName(c)
        ? `${greet(c)} What name would you like us to use on your account?`
        : `Hi, it's ${site.name}. What name should we put on your account?`,
  },

  {
    key: 'address',
    label: 'Address',
    needed: NEEDED.BOOKING,
    read: (c) => ({
      value: addressLine(c) || null,
      state: booking.hasAddress(c) ? STATES.EXPLICIT : STATES.MISSING,
    }),
    ask: 'Request Address',
    update: 'Request Update',
    // NEVER ASK FOR THE STATE. Neil's rule, and the code already agrees: this
    // is a Bergen County round, inServiceArea() checks the ZIP, and asking
    // somebody which state they live in reads as a form rather than a text.
    text: (c) => `${greet(c)} What address should we pick your laundry up from?`,
  },

  {
    key: 'pickup_date',
    label: 'Pickup date',
    // NOT `BOOKING`. It is required to create a pickup and its absence is the
    // ordinary resting state of a returning customer - somebody whose last
    // order was delivered on Friday is missing nothing. Filing it with name and
    // address would make every settled customer look half set up, and would
    // pull all of them into the AI's mid-setup nudge.
    needed: NEEDED.PICKUP,
    read: (c, ctx) => {
      const order = ctx.order;
      if (!order) return { value: null, state: STATES.MISSING };

      return {
        value: format.displayDate(order.pickup_date),
        state: STATES.EXPLICIT,
        // ONCE THE BAG IS OURS THERE IS NOTHING TO REQUEST. You cannot change
        // the day we already collected on; it happened. Neil's rule 32: the UI
        // may still offer an update, but it must not imply a field can still
        // move an order that has left the doorstep.
        settled: !ctx.awaiting,
      };
    },
    ask: 'Request Pickup Date',
    update: 'Request Change',
    text: (c, ctx) => {
      // AND IT HONOURS THE OPENING DATE, exactly as the old pickup nudge did.
      // Asking somebody when they would like a pickup and then refusing every
      // date they can think of is the bug the opening date was added to stop.
      const from = ctx.opensOnLabel ? ` We start pickups on ${ctx.opensOnLabel}.` : '';
      return `${greet(c)}${from} What day would work for your next pickup?`;
    },
  },

  {
    key: 'pickup_time',
    label: 'Pickup time',
    // REQUESTABLE, NEVER REQUIRED. "Tomorrow" is a complete answer and the code
    // picks the band. Showing an absent time as a blocking error would turn the
    // one thing customers actually say into an error message.
    needed: null,
    read: (c, ctx) => {
      const order = ctx.order;

      // An order exists, so the honest answer is the window we PROMISED them,
      // not the time they asked for - that window is what the confirmation
      // said and what the van is held to.
      if (order && order.pickup_window_start) {
        return {
          // THE SAME WORDS THE ORDER HISTORY USES, three inches below this
          // table on the customer page. A second format for one window would
          // read as two different facts.
          value: booking.arrivalWindow(order),
          state: order.pickup_time ? STATES.EXPLICIT : STATES.DEFAULT,
          settled: !ctx.awaiting,
        };
      }

      // Nothing booked yet, but they may already have answered. pending_pickup
      // is where check_slot writes down what they said, and `anyTime` is there
      // precisely because "anytime is fine" read back as "not asked yet" and a
      // real customer was asked twice.
      const pending = c.pending_pickup || {};
      if (pending.time) {
        return { value: booking.readableTime(pending.time), state: STATES.EXPLICIT };
      }
      if (pending.anyTime) {
        return { value: 'Any time', state: STATES.EXPLICIT };
      }

      return { value: 'Any time', state: STATES.DEFAULT };
    },
    ask: 'Request Pickup Time',
    update: 'Request Pickup Time',
    text: (c) => `${greet(c)} Do you have a preferred time for the pickup?`,
  },

  {
    key: 'pickup_location',
    label: 'Pickup location',
    // OPTIONAL, AND ONE SPOT SERVES BOTH LEGS. There is deliberately no
    // "request return location" row: unless somebody says otherwise the clean
    // laundry goes back where the dirty came from, and making that a second
    // question is the form this product exists not to be.
    needed: null,
    read: (c) => {
      // BOTH FIELDS, NEWEST FIRST, exactly as run.spotOf() reads them.
      // special_instructions is where the AI saves the spot and where every
      // older customer's is; dropoff_spot is only set when somebody wants the
      // clean laundry left somewhere different. Checking dropoff_spot alone
      // says "nobody has told us" for almost everybody who has.
      const prefs = c.preferences || {};
      const spot = String(prefs.dropoff_spot || prefs.special_instructions || '').trim();

      if (spot) {
        return { value: spot.charAt(0).toUpperCase() + spot.slice(1), state: STATES.EXPLICIT };
      }
      return { value: 'Service address', state: STATES.DEFAULT };
    },
    ask: 'Request Pickup Location',
    update: 'Request Update',
    text: (c) =>
      `${greet(c)} Is there a specific place at the property where you'd like us to ` +
      `pick up your laundry?`,
  },

  {
    key: 'water_temp',
    label: 'Water temperature',
    needed: null,
    read: (c) => washRow(c, 'water_temp', (choice) => choice.label),
    ask: 'Request Water Temp',
    update: 'Request Update',
    text: (c) =>
      `${greet(c)} What water temperature would you like us to use: cold, warm, or hot?`,
  },

  {
    key: 'fabric_softener',
    label: 'Fabric softener',
    needed: null,
    // THE SHORT NAME, WHICH IS A YES AND A NO. "Standard scented" is what a
    // laundromat reads off a ticket; a customer chose yes or no.
    read: (c) => washRow(c, 'fabric_softener', (choice) => choice.short || choice.label),
    ask: 'Request Softener Preference',
    update: 'Request Update',
    text: (c) => `${greet(c)} Would you like fabric softener used on your laundry?`,
  },

  // DETERGENT IS NOT A ROW, AND MUST NOT BECOME ONE. It is standard across the
  // board, Neil's call, and it lives in wash.STANDARDS - printed on the
  // laundromat's ticket, never asked of a customer. Same as drying and sorting.

  {
    key: 'service_type',
    label: 'Service type',
    needed: null,
    read: (c, ctx) => {
      // A SUBSCRIPTION IS AN ACTIVE STANDING ORDER AND NOTHING ELSE.
      //
      // Never inferred from how often somebody orders, from a plan they used to
      // have, or from another order. subscription.chose() fails towards the
      // higher price for the same reason: charging $2.00 to somebody who meant
      // to subscribe is a conversation, and enrolling somebody who did not ask
      // is a chargeback.
      if (ctx.subscriptionPlan) {
        return { value: subscription.CUSTOMER_WORD, state: STATES.EXPLICIT };
      }
      return { value: 'One-Time', state: STATES.DEFAULT };
    },
    ask: 'Request Service Type',
    update: 'Request Update',
    // BOTH RATES READ OFF subscription.js, never typed. Two copies of "$1.80"
    // is two rules, and the one that disagreed would be the one nobody noticed
    // until a card was charged.
    text: (c) =>
      `${greet(c)} Would you like this as a one-time pickup at ${subscription.oneTimeRate()}, ` +
      `or a ${subscription.CUSTOMER_WORD} pickup at ${subscription.subscriptionRate()}?`,
  },

  {
    key: 'frequency',
    label: 'Frequency',
    needed: null,
    read: (c, ctx) => {
      // N/A IS AN ANSWER, NOT A GAP. A one-time pickup has no frequency and
      // never will; showing it as missing would put a permanent request button
      // on every customer who is not a subscriber.
      if (!ctx.subscriptionPlan) return { value: null, state: STATES.NA };

      const label = subscription.frequencyLabel(ctx.subscriptionPlan.cadence);
      return label
        ? { value: label.charAt(0).toUpperCase() + label.slice(1), state: STATES.EXPLICIT }
        : { value: null, state: STATES.MISSING };
    },
    ask: 'Request Frequency',
    update: 'Request Update',
    text: () =>
      `How often would you like your ${subscription.CUSTOMER_WORD} pickup: ` +
      `${subscription.FREQUENCIES.map((f) => f.label).join(', ')}?`,
  },

  {
    key: 'card',
    label: 'Card',
    needed: NEEDED.DISPATCH,
    read: (c, ctx) => {
      // WITH NO PAYMENT PROVIDER THERE IS NOTHING TO ASK FOR. This is how the
      // system ran for months before the keys existed, and needsCardOnFile()
      // already answers false there so a sandbox does not empty the round. A
      // permanent red row on every customer would be the screen version of the
      // same mistake.
      if (!ctx.paymentsOn) {
        return { value: 'Payments are switched off', state: STATES.NA };
      }

      const described = billing.describeCard(c);
      return described
        ? { value: described, state: STATES.EXPLICIT }
        : { value: 'No card on file', state: STATES.MISSING };
    },
    // THE CARD ROW IS NOT AN ORDINARY REQUEST ROW. The words are editable; the
    // link is not, and it does not exist until the button is pressed - minting
    // one on every page load would leave a trail of Stripe sessions behind.
    //
    // IT IS CALLED "ASK", NOT "SEND", AND THAT IS NOT TIDYING. There is a
    // second button now - "Send card link", on the customer page and in the
    // conversation's send area - which texts the same /pay address with no
    // sentence around it at all. Two controls a thumb apart both reading "Send
    // Card Link" and sending different messages is the sort of thing somebody
    // presses once and then does not trust again. This one asks, in words; that
    // one sends a link.
    ask: 'Ask for a card',
    update: 'Ask them to update it',
    // What the composer is prefilled with. The URL is appended by send(), which
    // is why this sentence ends on a colon.
    text: (c) => `${greet(c)} We just need a card on file before pickup. You can securely add it here:`,
    // MINTED AT SEND, NEVER AT DRAW.
    link: (c) => billing.createSetupLink(c).then((r) => r.url),
  },
];

// Water temperature and softener read the same way, so they are read by the
// same function: a stored value we still offer is a choice, anything else is
// the default. `wash.isValid()` rather than "is it set", because a value we no
// longer offer would satisfy a presence check and then quietly fall back at
// wash time - somebody's clothes washed a way they did not choose, with nothing
// saying so.
function washRow(customer, key, describe) {
  const prefs = (customer || {}).preferences || {};
  const chosen = wash.isValid(key, prefs[key]);
  const choice = wash.choiceFor(key, prefs[key]);

  return {
    value: choice ? describe(choice) : null,
    state: chosen ? STATES.EXPLICIT : STATES.DEFAULT,
  };
}

// --- have we already asked --------------------------------------------------
//
// Neil's rule 23: a row that has been asked about and not yet answered says so,
// rather than looking as though nothing has been done. The action stays
// available - a deliberate follow-up is a real thing to want - it simply stops
// the screen inviting the same question four times in a morning.
//
// `messages.asked_for` IS STORED, AND IT IS THE ONE THING HERE THAT IS.
//
// That is not a workflow-stage column, which his brief rules out and so does
// this codebase: it is a label on an outbound message saying what that message
// asked for, which is a fact about something we DID. It is the same argument
// CLAUDE.md already makes for orders.reminder_sent_at - "the nearest derivation
// is searching `messages` for a sentence that looks like a reminder, which
// breaks the first time the wording changes".
//
// And here the wording is MEANT to change: the whole point of the composer is
// that an admin edits the sentence before sending it. Matching on text would be
// a rule that works until somebody uses the feature.
//
// ANSWERED IS SIMPLY "THEY HAVE SPOKEN SINCE". We do not try to work out
// whether their reply was about this field - the AI does that, and it can
// answer five rows from one message. Anything the customer says clears every
// outstanding ask, which is the safe direction: the cost of being wrong is a
// row that stops saying "awaiting reply" slightly early, and the state itself
// is still derived from the real value.
async function askedFor(phone) {
  if (!phone) return new Map();

  const { data, error } = await db
    .from('messages')
    .select('direction, asked_for, created_at')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) throw error;

  const asked = new Map();

  for (const row of data || []) {
    // Oldest-last, so the first inbound we meet walking backwards is their last
    // word. Everything before it has been answered as far as this is concerned.
    if (row.direction === 'INBOUND') break;
    if (row.asked_for && !asked.has(row.asked_for)) {
      asked.set(row.asked_for, row.created_at);
    }
  }

  return asked;
}

// --- the table --------------------------------------------------------------

// Everything the system knows about this customer, as rows.
//
// The context is read ONCE here rather than by each field, so the page makes
// one pass at the database however many rows come back - the same shape the old
// gapsFor() used.
async function fieldsFor(customer, { asked = true } = {}) {
  const [awaiting, live, schedules, opensOn, seen] = await Promise.all([
    orders.findAwaitingCollection(customer.id).catch(() => null),
    latestLiveOrder(customer.id).catch(() => null),
    recurring.forCustomer(customer.id).catch(() => []),
    settings.opensOn().catch(() => null),
    asked ? askedFor(customer.phone).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);

  // A date that has passed counts as no date, the same way it does everywhere
  // else - nobody has to remember to clear it.
  const opening = opensOn && opensOn > booking.today() ? opensOn : null;

  const order = awaiting || live;

  const ctx = {
    order,
    // Is that order still ahead of the van? Past this the row describes
    // something that has already happened.
    awaiting: Boolean(awaiting),
    subscriptionPlan: (schedules || []).find((s) => s.status === 'ACTIVE') || null,
    opensOnLabel: opening ? booking.readableDate(opening) : null,
    paymentsOn: billing.paymentsConfigured(),
  };

  return FIELDS.map((f) => row(f, customer, ctx, seen));
}

function row(field, customer, ctx, seen) {
  const read = field.read(customer, ctx) || {};
  const state = read.state || STATES.MISSING;

  // NOTHING IS REQUESTED ON A ROW THAT HAS NOTHING TO REQUEST. N/A is an
  // answer; a settled pickup date is history.
  const actionable = state !== STATES.NA && !read.settled;

  const text = actionable ? field.text(customer, ctx) : null;

  return {
    key: field.key,
    label: field.label,
    value: read.value == null ? null : String(read.value),
    state,
    needed: field.needed || null,
    // What this row is actually stopping, in the three senses NEEDED draws
    // apart. Only a MISSING row can stop anything.
    blocks: state === STATES.MISSING ? field.needed || null : null,
    action: actionable ? (state === STATES.MISSING ? field.ask : field.update) : null,
    text,
    // What the standard wording costs. It is the DEFAULT's cost - the composer
    // is editable and the page cannot count what somebody has not typed yet -
    // and the screen says so rather than implying the figure covers an edit.
    cost: text ? notify.describeCost(notify.toPlainText(text)) : null,
    // True when the words above are an illustration rather than the message
    // that will actually go: only the card row, whose link is minted on send.
    approximate: Boolean(field.link),
    // When we last asked for this and have heard nothing since.
    askedAt: seen.get(field.key) || null,
  };
}

// The order this customer currently has with us, when nothing is awaiting
// collection. It is what makes the table stay useful after a booking: a
// customer whose bag is at a laundromat has a pickup date, and showing "-" for
// it would read as nothing booked.
async function latestLiveOrder(customerId) {
  const { data, error } = await db
    .from('orders')
    .select('id, order_number, status, pickup_date, pickup_time, pickup_window_start, pickup_window_end, subscription_id')
    .eq('customer_id', customerId)
    .in('status', orders.IN_OUR_HANDS)
    .order('pickup_date', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data || [])[0] || null;
}

// --- what is actually in the way --------------------------------------------

// The rows standing between this customer and a booking, or between a booking
// and a van. Used by the screens for the one-line summary and by the AI's
// mid-setup test.
//
// PICKUP IS NOT IN IT, deliberately. "No pickup booked" is the resting state of
// every customer between orders, and counting it here would make all of them
// look stuck.
function blocking(fields) {
  return (fields || []).filter(
    (f) => f.blocks === NEEDED.BOOKING || f.blocks === NEEDED.DISPATCH
  );
}

// --- sending ----------------------------------------------------------------

// Send one field's request.
//
// `message` is what is in the composer - the standard wording, or whatever the
// admin edited it to. Neil's rule 15: there is one workflow, not a standard
// button beside a custom one. Prefilled, optionally edited, sent.
//
// `state` is the state the admin was looking at when the page was drawn. See
// the stale check below.
async function send(key, customer, { message = null, state = null } = {}) {
  const field = FIELDS.find((f) => f.key === key);
  if (!field) return { ok: false, reason: 'unknown' };

  // NO BACKDOOR AROUND STOP. The table stays visible for an opted-out customer
  // and everything on it stays readable; nothing on it may text them.
  // notify.sendAndLog() would refuse this anyway - it is the last gate and it
  // reads the number afresh - and it is refused here as well so the screen can
  // say why rather than reporting a send that quietly did nothing.
  if (customer.status === 'UNSUBSCRIBED') return { ok: false, reason: 'unsubscribed' };

  // THE SCREEN MAY BE STALE, AND THE CARD IS THE CASE THAT MATTERS.
  //
  // Neil's rule 24: an admin opens the thread, the card row reads Missing, the
  // customer saves a card from their own browser, and the admin presses Send
  // Card Link. The old nudges re-derived the gap for exactly this reason; this
  // is the same protection widened from "is it still missing" to "is it still
  // the same answer", because every row now has an action whether or not it is
  // missing.
  const fields = await fieldsFor(customer, { asked: false });
  const now = fields.find((f) => f.key === key);

  if (!now || !now.action) return { ok: false, reason: 'not_askable', field: now || null };
  if (state && now.state !== state) return { ok: false, reason: 'stale', field: now };

  const body = String(message == null ? now.text : message).trim();
  if (!body) return { ok: false, reason: 'empty' };

  // THE LINK IS THE BACKEND'S AND THE ADMIN MAY NOT TYPE ONE. The composer
  // holds the words; the payment address is minted here, now, and appended.
  // An admin-editable payment URL in a text message is the shape of the exact
  // thing cardDestination() exists to avoid.
  let text = body;
  if (field.link) {
    const url = await field.link(customer);
    text = `${body} ${url}`;
  }

  // Through notify like every other outbound.
  //
  // AND NOT STAMPED sent_by, EVEN WHEN THE WORDS WERE EDITED. Neil's rules 34
  // and 41: starting a question from this table must not read as a person
  // permanently taking the thread over. `sent_by` is what puts brain.js into
  // its handover behaviour - carry on from where they left off, never
  // contradict what they said, hand off rather than guess - and that is wrong
  // for a one-line question whose entire purpose is that the AI handles the
  // answer. A person pressed a button; nobody is working the thread by hand.
  await notify.sendAndLog(customer.phone, text, customer.id, { askedFor: key });

  return { ok: true, text };
}

module.exports = {
  STATES,
  NEEDED,
  FIELDS,
  fieldsFor,
  blocking,
  send,
  // Exported for the tests, which is the whole reason the reading is separate
  // from the drawing: these are the rules that decide what an operator is told
  // about a customer, and none of them should need a database to check.
  row,
  addressLine,
  greet,
  firstName,
};
