'use strict';

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
const booking = require('./booking');
const issues = require('./issues');
const recurring = require('./recurring');
const settings = require('./settings');
const wash = require('./wash');
const geocode = require('./geocode');
const payments = require('../providers/payments');
const { config } = require('../config');
const { site } = require('../web/site');

// ---------------------------------------------------------------------------
// The seven actions.
//
// Claude decides WHICH of these to run. This file decides what actually
// happens. Every check that matters lives here, not in the prompt:
//
//   - a customer can only cancel their own order, and only before collection
//   - a locker is resolved from the caller's own order, never from what they typed
//   - dates are validated against today, not trusted
//
// Each function returns the text to send back. Writing the reply here rather
// than letting Claude write it means a price or a date in a confirmation is
// always a real value read from the database.
// ---------------------------------------------------------------------------

// --- Small helpers ----------------------------------------------------------

// readableDate, dateProblem and hasAddress live in src/core/booking.js now,
// so the AI and the website apply identical rules.
const { readableDate, dateProblem, timeProblem, normaliseTime, hasAddress } = booking;

// --- create_order -----------------------------------------------------------

async function createOrder(customer, input) {
  // The rules live in src/core/booking.js so the website and this agree. All
  // that happens here is turning the result into a sentence.
  const result = await booking.bookPickup(customer, {
    pickupDate: input.pickup_date,
    pickupTime: input.pickup_time,
    pickupMethod: input.pickup_method,
    bagCount: input.bag_count,
    notes: input.notes,
  });

  if (!result.ok) {
    switch (result.reason) {
      // Shut. The reason is Neil's own words, worked into the sentence rather
      // than pasted after it, so the customer reads one message from a person
      // instead of an apology with a notice stapled to the end.
      case 'not_taking_orders':
        return result.detail
          ? `We're not booking pickups just yet - ${result.detail} I'll let you know the moment we are.`
          : `We're not booking pickups just yet, sorry. I'll let you know the moment we are.`;
      case 'no_address':
        // SAY WHICH PART IS MISSING. "I don't have an address on file" is a
        // flat contradiction to somebody who just gave one and watched it read
        // back in a recap - which is exactly what happened: street and city
        // saved, no zip, and the refusal claimed we had nothing.
        //
        // The zip is not bureaucracy here. It is the single thing that decides
        // whether an address is in Bergen County, so a booking genuinely cannot
        // proceed without it.
        return customer.address_line1 && !customer.postal_code
          ? `Almost there - what's the zip code for ${customer.address_line1}?`
          : `I don't have an address on file for you. Send your street address and I'll get it saved.`;
      // ASK FOR THE ONE THING THAT IS MISSING. They gave a name once and it was
      // lost between the giving and the saving; asking again is a small cost
      // against a driver turning up for "Unnamed customer".
      case 'no_name':
        return `Almost there - what name should I put on it?`;
      case 'out_of_area':
        return (
          `We don't reach ${customer.city || 'your area'} just yet, sorry. We cover ` +
          `${site.serviceArea} right now, and we'll text you the moment that changes.`
        );
      case 'no_preferences':
        return (
          `Almost there! ${wash.QUESTION}`
        );
      case 'bad_date':
      case 'bad_time':
        return result.detail;
      // Booked before the van starts running. Its own case rather than falling
      // in with bad_date, because nothing is wrong with what they asked for -
      // we are simply not there yet, and the sentence has to read as an
      // invitation rather than a correction.
      case 'before_opening':
        return result.detail;
      // The run they asked for has gone. The sentence explains which one and
      // offers the next; nothing has been booked, and nothing will be until
      // they say yes and the AI calls again with a time we can actually do.
      case 'time_unavailable':
        return result.say;
      // NOT "book another one" - "put it out with the one you have". Neil's
      // call, and it is the obvious answer: the van has not been to that door
      // yet today, so extra bags need no second visit and no second booking.
      // Offering to move it or add another sends somebody away to arrange
      // something they do not need.
      case 'already_booked':
        return (
          `Your pickup ${booking.whenLine(result.order)} hasn't been yet - just ` +
          `put the extra bags out with the rest and the driver will take the lot. ` +
          `Want different wash details on any of it?`
        );
      default:
        return `Let me get a person on this. Someone will come back to you shortly.`;
    }
  }

  // The details are settled and the order exists. Only now does the card come
  // into it, which is the order Neil asked for: never ask for payment before
  // there is something to pay for.
  if (result.needsCard) {
    // Booked but unconfirmed. Saving a card finishes it off automatically,
    // from the payment webhook, so they never have to say it twice.
    //
    // Says plainly that nothing is being taken now. Somebody handed a payment
    // link inside a booking conversation assumes they are being asked to pay,
    // and the single most common reason to abandon it is not knowing how much.
    const { url } = await billing.createSetupLink(customer);

    return (
      `${booking.whenLine(result.order)} it is. One thing first: we need a card on ` +
      `file before the driver comes out. Nothing gets taken now - it's ` +
      `${site.pricePerLb} a pound with a ${billing.money(config.pricing.minimumCents)} minimum, ` +
      `charged when we drop your laundry back. Our payment provider handles it and we ` +
      `never see the number: ${url}`
    );
  }

  // The wording lives in src/core/booking.js so that booking by text and
  // booking on the website produce the identical confirmation.
  return booking.confirmationMessage(customer, result.order, { rolled: result.rolled });
}

// --- get_order_status -------------------------------------------------------

async function getOrderStatus(customer) {
  const order = (await orders.findLatestInFlight(customer.id)) || (await orders.findMostRecent(customer.id));

  if (!order) {
    return `You haven't got anything booked with us yet. Say the word and I'll arrange a pickup.`;
  }

  const when = booking.whenLine(order);

  switch (order.status) {
    case 'REQUESTED':
      return `You're all set for ${when}. Nothing to do until then.`;
    case 'ASSIGNED':
      return `You're down for ${when} and your locker's ready.`;
    case 'DEPOSITED':
      return `Got your laundry in the locker, it's on the next collection.`;
    case 'IN_PROCESS':
      return `Got it, it's being washed now. Back with you the ${site.turnaround}.`;
    // AT_PARTNER and READY were missing entirely, so both fell through to
    // "let me check on that" - useless, and it invited the AI to explain
    // itself, which is how a customer got told their laundry was at a partner.
    // Neither answer mentions where the work happens, because that is ours.
    case 'AT_PARTNER':
      return `It's being washed and folded now. Back with you the ${site.turnaround}.`;
    case 'READY':
      return `All washed and folded. It goes out for delivery next.`;
    case 'OUT_FOR_DELIVERY':
      return `Washed, folded and out for delivery today.`;
    case 'DELIVERED': {
      const cost = order.price_cents ? ` It came to $${(order.price_cents / 100).toFixed(2)}.` : '';
      return `That one's back with you already.${cost} Want another pickup?`;
    }
    case 'CANCELED':
      return `That one was cancelled. Want me to book a new one?`;
    default:
      return `Let me check on that and come back to you.`;
  }
}

// WHICH PICKUP DID THEY MEAN?
//
// A customer can have several booked now - one per day - so "move it" and
// "cancel it" are only unambiguous when there is exactly one. With several,
// this refuses to guess and hands back a question instead. Acting on whichever
// happened to be soonest would cancel the wrong laundry, and there is no undo
// for that.
//
// Returns { order } when it is clear, or { ask } with a sentence to send.
async function whichPickup(customer, whichDate, verb) {
  const open = await orders.findAllAwaitingCollection(customer.id);

  if (!open.length) return { order: null };
  if (open.length === 1) return { order: open[0] };

  // The AI named a day: use it, if they actually have one that day.
  if (whichDate) {
    const wanted = open.find((o) => o.pickup_date === whichDate);
    if (wanted) return { order: wanted };
  }

  // A question, not a menu. "Thursday or Friday?" is what a person would say,
  // and it is the one case where asking is better than choosing.
  const days = open.map((o) => booking.readableDate(o.pickup_date));
  const list =
    days.length === 2
      ? `${days[0]} and ${days[1]}`
      : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;

  return { ask: `You've got pickups booked for ${list}. Which one did you want to ${verb}?` };
}

// --- reschedule_order -------------------------------------------------------

async function rescheduleOrder(customer, input) {
  const problem = dateProblem(input.new_date);
  if (problem) return problem;

  const timeIssue = timeProblem(input.new_time);
  if (timeIssue) return timeIssue;

  const chosen = await whichPickup(customer, input.which_date, 'move');
  if (chosen.ask) return chosen.ask;

  const order = chosen.order;

  if (!order) {
    const inFlight = await orders.findLatestInFlight(customer.id);
    if (inFlight) {
      return `That one's already been collected, so I can't move it. Want to book your next pickup instead?`;
    }
    return `You haven't got a pickup booked to move. What day would suit you?`;
  }

  // undefined, not null, when the AI didn't mention a time — otherwise every
  // plain "move it to Friday" would wipe the time they asked for last week.
  const newTime = input.new_time === undefined ? undefined : normaliseTime(input.new_time);

  // Only a no-op if the day AND the time are both what's already on the order.
  // Checking the date alone would refuse "same day but make it 4 instead of 6".
  const sameDay = order.pickup_date === input.new_date;
  const sameTime = !newTime || newTime === normaliseTime(order.pickup_time);
  if (sameDay && sameTime) {
    return `You're already down for ${booking.whenLine(order)}.`;
  }

  // Whatever time they end up with, they get a real window back, chosen the
  // same way a fresh booking chooses one.
  const window = booking.windowFor(
    input.new_date,
    newTime === undefined ? normaliseTime(order.pickup_time) : newTime
  );

  // WE DO NOT MOVE SOMEBODY TO A TIME THEY DID NOT ASK FOR.
  //
  // A customer texted "update my order to be picked up today at 1" at ten past
  // twelve and got back, as settled fact, "no problem at all, we've moved it to
  // Wednesday 2 Sep between 2 and 4pm". The window was correct - the midday run
  // had already gone out - but nobody asked them whether 2 to 4 suited, and the
  // order had already been changed by the time they read it.
  //
  // So the code refuses instead. It explains which run has gone, offers the
  // next one, and asks. Nothing is written.
  //
  // THE SECOND CALL NEEDS NO NEW ARGUMENT AND NO REMEMBERED STATE: if they say
  // yes, the AI calls again with a time inside the window it was offered, that
  // time is one we can actually do, and it books. If they say no, nothing ever
  // happened. Same shape as the booking recap - the model asks, the code
  // decides - and it cannot be talked past, because the refusal is arithmetic.
  if (window.substituted) return booking.cannotDoThatTime(window);

  // The customer moved it themselves, in the thread. That is who the log
  // should name, not the system that carried it out.
  const updated = await orders.reschedule(order, input.new_date, newTime, window, {
    actor: 'customer',
  });
  return booking.rescheduledMessage(updated);
}

// --- cancel_order -----------------------------------------------------------

async function cancelOrder(customer, input = {}) {
  const chosen = await whichPickup(customer, input.which_date, 'cancel');
  if (chosen.ask) return chosen.ask;

  const order = chosen.order;

  if (!order) {
    const inFlight = await orders.findLatestInFlight(customer.id);
    if (inFlight) {
      return `Your laundry is already with us, so that one can't be cancelled. It'll be back the ${site.turnaround}.`;
    }
    return `You haven't got anything booked to cancel.`;
  }

  await orders.transition(order, 'CANCELED');

  // The minimum comes back. "Free until the driver collects" is promised on
  // the website, in the AI's replies and on the Stripe consent page, so it has
  // to actually happen rather than be a thing we say.
  const refund = await billing.refundDeposit(order);

  if (refund.refunded) {
    return (
      `Cancelled, and the ${billing.money(refund.amountCents)} minimum is on its way back to your card. ` +
      `Text me whenever you want to book again.`
    );
  }

  return `Cancelled, no charge. Text me whenever you want to book again.`;
}

// --- open_locker ------------------------------------------------------------

async function openLocker(customer) {
  // The compartment is resolved from THIS customer's own order. Nothing the
  // customer typed is used to choose it — that is the whole security model.
  const order = await orders.findAwaitingCollection(customer.id);

  if (!order || !order.locker_id) {
    return (
      `You haven't got a locker assigned. We collect from your door at the moment. ` +
      `Say when you'd like a pickup and I'll book it.`
    );
  }

  // Phase 7 wires this to the real hardware. Until then, refuse honestly
  // rather than telling someone a door opened when it did not.
  return `Locker unlocking isn't switched on yet. Email ${site.email} and we'll sort it out.`;
}

// --- What may still be changed, and when ------------------------------------
//
// Once a bag is in our hands, some things are settled and some are not:
//
//   ADDRESS        locked. A bag already on the van does not get redirected to
//                  a different building, and "send it somewhere else" on an
//                  order in flight is also the shape most delivery fraud takes.
//   WASH SETTINGS  locked. It may already be washed. Promising warm water to
//                  somebody whose clothes went through cold an hour ago is a
//                  promise we cannot keep.
//   WHERE TO LEAVE IT   open right up until delivery. "Actually put it in the
//                  garage" is the same address and the same driver, so there
//                  is no reason to refuse it.
//
// Enforced here rather than in the prompt, because a model asked nicely is not
// a control. The prompt explains the rules so the AI does not promise
// something this will then refuse.

const ADDRESS_FIELDS = ['address_line1', 'address_line2', 'city', 'state', 'postal_code'];
// DETERGENT IS NOT HERE ANY MORE. It is standard for everybody, so there is
// nothing to change and nothing to lock while we hold their laundry.
const WASH_FIELDS = ['water_temp', 'fabric_softener'];

// Returns a sentence if this change is not allowed right now, or null.
async function lockedWhileWithUs(customer, fields) {
  const wantsAddress = fields.some((f) => ADDRESS_FIELDS.includes(f));
  const wantsWash = fields.some((f) => WASH_FIELDS.includes(f));

  if (!wantsAddress && !wantsWash) return null;

  const held = await orders.findInOurHands(customer.id);
  if (!held) return null;

  if (wantsAddress) {
    return (
      `We've already got order #${held.order_number}, so I can't change the address it ` +
      `goes back to. It'll come back to ${customer.address_line1}. I can change where ` +
      `at the property we leave it, though, so tell me if you'd like that somewhere else.`
    );
  }

  return (
    `Order #${held.order_number} is already with us and may well be washed by now, so ` +
    `I can't change how it's done this time. I've kept your usual settings and I'll ` +
    `apply any change from your next pickup, just say the word.`
  );
}

// --- update_profile ---------------------------------------------------------

// Columns on the customer row, versus keys inside the preferences JSON.
const PROFILE_COLUMNS = ['name', 'email', 'address_line1', 'address_line2', 'city', 'state', 'postal_code'];
const PREFERENCE_KEYS = [
  'water_temp',
  'fabric_softener',
  // Structured on purpose: having this as a field is what stops it being typed
  // into free text, which is the one place a customer will also type an address
  // or a company name.
  //
  // DRYING IS NOT ON THIS LIST AND MUST NOT GO BACK ON IT. We tumble dry
  // everything, so it is not a choice on offer. A writable field for it is a
  // promise the operation does not keep, and the AI would eventually accept one
  // because somebody asked nicely.
  'separate_darks',
  'special_instructions',
  'default_pickup_method',
];

async function updateProfile(customer, input) {
  const field = String(input.field || '');
  const value = String(input.value || '').trim();

  if (!value) return `What would you like me to change it to?`;

  const locked = await lockedWhileWithUs(customer, [field]);
  if (locked) return locked;

  if (PROFILE_COLUMNS.includes(field)) {
    const stored = field === 'state' ? value.toUpperCase() : value;

    // Same rule as save_details: changing one line of an address is still a
    // move, and a stale pin is worse than no pin because nothing looks wrong.
    const { data: saved, error } = await db
      .from('customers')
      .update(geocode.clearPinIfMoved(customer, { [field]: stored }))
      .eq('id', customer.id)
      .select('*')
      .single();

    if (error) throw error;

    if (saved && saved.lat == null && saved.address_line1) {
      geocode.locate(saved).catch(() => {});
    }

    return `Done, that's saved.`;
  }

  if (PREFERENCE_KEYS.includes(field)) {
    const preferences = { ...(customer.preferences || {}) };
    // VALIDATED, NOT COERCED. fabric_softener was still being stored as a
    // boolean from "yes"/"no" here, exactly as it was in save_details before
    // that was fixed - and wash.js expects STANDARD, NONE or FRAGRANCE_FREE.
    // A boolean in that column fails hasPreferences() and puts the customer
    // straight back into the loop where the AI asks the same question forever.
    if (!wash.isValid(field, value)) {
      return `I did not catch which option you meant. ${wash.QUESTION}`;
    }

    preferences[field] = value;

    const { error } = await db.from('customers').update({ preferences }).eq('id', customer.id);
    if (error) throw error;
    // Deliberately not "I'll use that from your next pickup" — this often runs
    // one step before a booking, and a real customer who had just approved a
    // recap was told exactly that instead of getting their order booked. The
    // chaining in sms.js finishes the booking; this reply only survives when
    // there genuinely was nothing else to do.
    return `Done, that's saved.`;
  }

  // Claude asked to change something we don't store. Hand over rather than
  // silently doing nothing.
  return `I'll pass that to someone who can sort it. You'll hear back shortly.`;
}

// --- save_details -----------------------------------------------------------

// The state is defaulted, not asked for. Everyone we serve is in New Jersey,
// so making a new customer spell it out is a question with one possible answer.
const DEFAULT_STATE = 'NJ';

async function saveDetails(customer, input) {
  const clean = (value, max) => String(value || '').trim().slice(0, max);

  // The same locks as update_profile. This tool can set an address and a wash
  // in one call, so it has to obey them too, or the rule would depend on which
  // tool the model happened to reach for.
  const attempted = [
    ...ADDRESS_FIELDS.filter((f) => clean(input[f], 200)),
    ...WASH_FIELDS.filter((f) => input[f]),
  ];

  const locked = await lockedWhileWithUs(customer, attempted);
  if (locked) return locked;

  const changes = {};
  if (clean(input.name, 80)) changes.name = clean(input.name, 80);
  if (clean(input.address_line1, 120)) changes.address_line1 = clean(input.address_line1, 120);
  if (clean(input.address_line2, 80)) changes.address_line2 = clean(input.address_line2, 80);
  if (clean(input.city, 80)) changes.city = clean(input.city, 80);
  if (clean(input.postal_code, 10)) changes.postal_code = clean(input.postal_code, 10);

  const state = clean(input.state, 2).toUpperCase();
  if (state) changes.state = state;

  // Wash preferences and the handover spot, exactly as they chose them.
  // These only ever come from the customer's own words — there are no
  // defaults, and a booking is refused until they exist.
  const prefs = { ...(customer.preferences || {}) };
  let prefsChanged = false;

  // VALIDATED THROUGH wash.js, NOT AGAINST A LIST TYPED OUT HERE.
  //
  // This is where every new customer's setup was silently failing. The lists
  // here had not moved when the wash options did: detergent still accepted
  // HYPOALLERGENIC, which no longer exists, so the FREE_CLEAR the AI correctly
  // sent was DROPPED ON THE FLOOR. Softener was worse - stored as a boolean
  // from "yes"/"no" while wash.js expects STANDARD, NONE or FRAGRANCE_FREE, so
  // it could never be valid at all.
  //
  // The effect was a loop nobody could get out of: the customer answers, the
  // answer is thrown away, hasPreferences() stays false, and the AI asks the
  // same question again. Neil watched it happen on a live thread and had to
  // raise an issue against it.
  //
  // wash.isValid is the only thing that decides now, so an option cannot exist
  // in the tool schema and be unwritable here ever again.
  for (const key of wash.KEYS) {
    if (wash.isValid(key, input[key])) {
      prefs[key] = input[key];
      prefsChanged = true;
    }
  }
  if (['LEAVE_OUTSIDE', 'HAND_TO_DRIVER'].includes(input.pickup_method)) {
    prefs.default_pickup_method = input.pickup_method;
    prefsChanged = true;
  }
  if (clean(input.pickup_spot, 200)) {
    prefs.special_instructions = clean(input.pickup_spot, 200);
    prefsChanged = true;
  }
  // Only set when they want it back somewhere else. Unset means "the same
  // place", which is what the confirmation promises.
  if (clean(input.dropoff_spot, 200)) {
    prefs.dropoff_spot = clean(input.dropoff_spot, 200);
    prefsChanged = true;
  }

  if (prefsChanged) changes.preferences = prefs;

  if (!Object.keys(changes).length) {
    return `Sorry, I didn't catch that. What's your name and the address we should collect from?`;
  }

  // Fill in the state once there is an address to attach it to, so a customer
  // is never blocked from booking by a field nobody asked them about.
  if (changes.address_line1 && !changes.state && !customer.state) {
    changes.state = DEFAULT_STATE;
  }

  // A MOVE THROWS THE MAP PIN AWAY. Without this the address changes and the
  // coordinates do not, so every routing decision is made about the old house -
  // which is exactly what happened when a customer moved to Glen Rock and the
  // map kept them in Fair Lawn.
  const { data: updated, error } = await db
    .from('customers')
    .update(geocode.clearPinIfMoved(customer, changes))
    .eq('id', customer.id)
    .select('*')
    .single();

  if (error) throw error;

  // Look the new address up in the background. It is a free rate-limited
  // service and a customer is waiting on a text, so nothing waits on it - and
  // if it fails, locate() will simply try again the next time a route is built.
  if (updated.lat == null && updated.address_line1) {
    geocode.locate(updated).catch((err) => {
      console.error(`Could not re-pin ${updated.id} after a move: ${err.message}`);
    });
  }

  // People are called by their first name. "Thanks Neil Perry" is what a
  // form-letter says; the full name stays in the database for the driver and
  // the books.
  const first = String(updated.name || '').trim().split(/\s+/)[0];

  // What is still missing decides what we say next. hasAddress() is the same
  // check bookPickup uses, so this can never claim someone is set up and then
  // refuse their first booking for want of an address.
  if (!updated.name) {
    return `Got the address. What should I call you?`;
  }

  if (!hasAddress(updated)) {
    if (!updated.address_line1) return `Thanks ${first}! And what's the street address?`;
    if (!updated.city) return `Thanks ${first}! Which town is that in?`;
    return `Thanks ${first}! And the zip code?`;
  }

  // NOT WHILE THE SERVICE IS SHUT.
  //
  // Everything below this walks somebody towards a booking - when do you want
  // it, how do you like it washed - and none of it can end in one while we are
  // not taking orders. The prompt already tells the AI not to ask; it could
  // never have stopped this, because THESE SENTENCES ARE WRITTEN HERE, in
  // code, and shipped as the tool's own reply.
  //
  // Neil caught it on a real conversation: a woman gave her street, her name
  // and her zip, was asked "when would you like it picked up?", and only when
  // she asked back did she find out we are not booking. Three questions to
  // arrive at no.
  //
  // Same split as everywhere else, just pointing the other way: the prompt
  // asks, the code enforces - so the code has to know too.
  //
  // AND IT HAS TO KNOW ABOUT THE EXEMPTION, which is the third place this
  // check lives. bookPickup() and the prompt both learned that Neil's own
  // number can book while the service is shut; this one did not, so his
  // conversation walked through the setup normally and then had a "we are not
  // booking just yet" pasted into the middle of it by a tool result. A rule
  // enforced in three places has to be taught in three places.
  if (!booking.alwaysAllowed(customer) && !(await settings.takingOrders())) {
    const reason = await settings.pausedReason();

    return (
      `Thanks ${first}, that's all saved. ` +
      `We're not booking pickups just yet${reason ? `, ${reason.replace(/\.$/, '')}` : ''}, ` +
      `so there's nothing to put on the calendar today. ` +
      `We'll text you the moment that changes.`
    );
  }

  // Address done. If they have not said WHEN yet, that comes before anything
  // about detergent: it is what they came here for, and it is what tells them
  // we can actually do it.
  //
  // Unless they already have laundry with us or a pickup booked, in which case
  // asking "when would you like it picked up?" is nonsense - a real customer
  // updating where to leave an order that was already at the laundromat got
  // exactly that.
  if (!input.pickup_date) {
    const busy =
      (await orders.findInOurHands(customer.id)) ||
      (await orders.findAwaitingCollection(customer.id));

    if (busy) return `Done, that's updated on order #${busy.order_number}.`;

    return `Thanks ${first}! When would you like it picked up?`;
  }

  // When is settled, so now the wash. Ask, never invent — this is the backstop
  // behind the prompt's instruction to ask, and it is what stops "we've set
  // you up with cold water" going to somebody who chose nothing.
  if (!booking.hasPreferences(updated)) {
    return (
      // ONE WORDING, FROM wash.js. This sentence is written in CODE and shipped
      // as the tool's own reply, so the prompt could never have corrected it -
      // which is exactly how "regular or hypoallergenic detergent" kept
      // reaching customers, naming an option that does not exist and quoting
      // neither $2 charge. The bag location is asked separately.
      wash.QUESTION
    );
  }

  // The address is complete. If the van doesn't go there, say so NOW — not at
  // their first booking attempt, which would waste the whole conversation.
  if (!booking.inServiceArea(updated)) {
    return (
      `Thanks ${first}, all saved. One thing though: we don't reach ` +
      `${updated.city || 'your area'} just yet. We cover ${site.serviceArea} right now, ` +
      `and we'll text you the moment that changes.`
    );
  }

  // They already said when they want the pickup — it is earlier in the thread
  // and the AI carries it into this call. Book it now rather than asking
  // "when would you like your first pickup?" at somebody who told us "today"
  // four messages ago. That exact reply went to a real tester.
  if (input.pickup_date) {
    return createOrder(updated, {
      pickup_date: input.pickup_date,
      pickup_time: input.pickup_time,
    });
  }

  return (
    `You're all set, ${first}! ${site.pricePerLb} a pound with a ` +
    `${billing.money(config.pricing.minimumCents)} minimum, back the ${site.turnaround}. ` +
    `When would you like your first pickup?`
  );
}

// --- set_pickup_schedule ----------------------------------------------------

async function setPickupSchedule(customer, input) {
  const first = String(customer.name || '').trim().split(/\s+/)[0];

  // A customer can have several standing orders now, so every branch below
  // loads them rather than reading one off the customer row.
  const schedules = await recurring.forCustomer(customer.id);
  const active = schedules.filter((s) => s.status === 'ACTIVE');

  // Skipping one, or pausing for a while, without touching the cadence.
  if (input.skip_next || input.pause_until) {
    if (!active.length) {
      return `You haven't got a repeating pickup set up, so there's nothing to skip.`;
    }

    // Whichever comes route first is the one they mean by "skip the next one".
    const soonest = active
      .map((s) => ({ s, on: recurring.nextDate(s) }))
      .filter((x) => x.on)
      .sort((a, b) => a.on.localeCompare(b.on))[0];

    const until = input.pause_until || (soonest && soonest.on);
    await recurring.pauseUntil(customer, until, soonest && soonest.s.id);

    const after = (await recurring.forCustomer(customer.id))
      .map((s) => recurring.nextDate(s))
      .filter(Boolean)
      .sort()[0];

    return (
      `No problem, skipped. Your next one is ${booking.readableDate(after)}. ` +
      `Text me any time if you want one sooner.`
    );
  }

  if (input.cadence === 'OFF') {
    if (!active.length) {
      return `You haven't got a repeating pickup running, so there's nothing to stop.`;
    }

    await recurring.stop(customer);
    return `Done, no more repeating pickups. Just text me whenever you want one.`;
  }

  if (!recurring.CADENCES[input.cadence]) {
    return `Would you like us every week, or every other week?`;
  }

  const weekday = Number(input.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return `Which day suits you?`;
  }

  const saved = await recurring.addSchedule(customer, {
    cadence: input.cadence,
    weekday,
    timeOfDay: input.time || null,
  });
  const next = recurring.nextDate(saved);

  // Says what they now have in total, not just what changed. Somebody adding a
  // Saturday to an existing Tuesday needs to hear both, or they will wonder
  // whether the Tuesday survived.
  const all = await recurring.forCustomer(customer.id);
  const others = all.filter((s) => s.status === 'ACTIVE' && s.id !== saved.id);

  // No mention of a total, because there isn't one: a schedule costs nothing
  // and each pickup is priced by weight exactly as it always was.
  return (
    `Sorted${first ? `, ${first}` : ''}! We'll come ${recurring.describe(saved)} from now on, ` +
    `starting ${booking.readableDate(next)}.` +
    (others.length ? ` That's on top of ${recurring.describeAll(others)}.` : '') +
    ` We'll text you the day before each one, and you can skip a week or stop any time by texting me.`
  );
}

// --- handoff_to_human -------------------------------------------------------

async function handoffToHuman(customer, input, helpers = {}) {
  const reason = String(input.reason || 'no reason given');

  // Which order, if they named one.
  //
  // Checked against THIS customer, never trusted. The order number is printed
  // in their own confirmation texts, so it is not secret, but somebody who
  // guesses a neighbour's number must not attach their complaint to it or see
  // it acknowledged.
  let order = null;

  if (input.order_number != null) {
    const wanted = Number(input.order_number);

    if (Number.isInteger(wanted)) {
      const { data, error } = await db
        .from('orders')
        .select('*')
        .eq('order_number', wanted)
        .eq('customer_id', customer.id)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        // Their own orders are in front of the AI, so this is a typo far more
        // often than anything else. Say so plainly and let them correct it,
        // rather than flagging a complaint against nothing.
        return (
          `I can't find order #${wanted} on your account. Could you check the ` +
          `number? It's in the text we sent when you booked.`
        );
      }

      order = data;
    }
  }

  const { issue, isNew } = await issues.raise({
    customer,
    order,
    reason,
    customerSaid: helpers.customerSaid,
  });

  console.log(
    `HANDOFF  ${customer.phone} (${customer.name || 'unnamed'})` +
      `${order ? ` order #${order.order_number}` : ''}: ${reason}` +
      `${isNew ? '' : ' [already open]'}`
  );

  const about = order ? ` about order #${order.order_number}` : '';

  // SOMEBODY WITH A PROBLEM IS NOT A DUPLICATE.
  //
  // The first version of this said "You're already with a manager and they've
  // got everything you've sent", which reads as "stop asking". A customer
  // chasing something that went wrong is not being a nuisance; they are
  // waiting, and often worried. So the follow-up acknowledges the wait and
  // confirms the new message was added, rather than restating a queue
  // position.
  if (!isNew) {
    return (
      `I've passed that straight on as well${about}, so they have everything. ` +
      `Sorry you're waiting on this, and thank you for bearing with us.`
    );
  }

  return (
    `I'm sorry about this. I've passed it to a manager${about} with everything ` +
    `you've told me, and they'll come back to you shortly.`
  );
}

// ---------------------------------------------------------------------------
// Run whichever action Claude chose
// ---------------------------------------------------------------------------

async function run(name, input, customer, helpers = {}) {
  switch (name) {
    case 'create_order':
      return createOrder(customer, input);
    case 'get_order_status':
      return getOrderStatus(customer);
    case 'reschedule_order':
      return rescheduleOrder(customer, input);
    case 'cancel_order':
      return cancelOrder(customer, input);
    case 'open_locker':
      return openLocker(customer);
    case 'update_profile':
      return updateProfile(customer, input);
    case 'save_details':
      return saveDetails(customer, input);
    case 'set_pickup_schedule':
      return setPickupSchedule(customer, input);
    case 'handoff_to_human':
      return handoffToHuman(customer, input, helpers);
    default:
      // Claude named a tool that doesn't exist. Should be impossible, but
      // failing into a human is the safe direction.
      console.error(`Unknown action requested: ${name}`);
      return `Let me get a person on this. Someone will come back to you shortly.`;
  }
}

module.exports = { run, readableDate };
