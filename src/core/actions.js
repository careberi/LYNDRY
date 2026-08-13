'use strict';

const db = require('../db');
const orders = require('./orders');
const billing = require('./billing');
const booking = require('./booking');
const issues = require('./issues');
const recurring = require('./recurring');
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
      case 'no_address':
        return `I don't have an address on file for you. Send your street address and I'll get it saved.`;
      case 'out_of_area':
        return (
          `We don't reach ${customer.city || 'your area'} just yet, sorry. We cover ` +
          `${site.serviceArea} right now, and we'll text you the moment that changes.`
        );
      case 'no_preferences':
        return (
          `Almost there! Just tell me how you like it washed: cold or warm water, ` +
          `regular or hypoallergenic detergent, and softener or no?`
        );
      case 'bad_date':
      case 'bad_time':
        return result.detail;
      case 'already_booked':
        return (
          `You've already got a pickup booked for ${booking.whenLine(result.order)}. ` +
          `Want me to move it, or add a second one after that?`
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
      `charged after we weigh your bag. Our payment provider handles it and we ` +
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
      return `Got it, it's being washed now. Back with you within ${site.turnaround}.`;
    // AT_PARTNER and READY were missing entirely, so both fell through to
    // "let me check on that" - useless, and it invited the AI to explain
    // itself, which is how a customer got told their laundry was at a partner.
    // Neither answer mentions where the work happens, because that is ours.
    case 'AT_PARTNER':
      return `It's being washed and folded now. Back with you within ${site.turnaround}.`;
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

// --- reschedule_order -------------------------------------------------------

async function rescheduleOrder(customer, input) {
  const problem = dateProblem(input.new_date);
  if (problem) return problem;

  const timeIssue = timeProblem(input.new_time);
  if (timeIssue) return timeIssue;

  const order = await orders.findAwaitingCollection(customer.id);

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

  const updated = await orders.reschedule(order, input.new_date, newTime, window);
  return booking.rescheduledMessage(updated);
}

// --- cancel_order -----------------------------------------------------------

async function cancelOrder(customer) {
  const order = await orders.findAwaitingCollection(customer.id);

  if (!order) {
    const inFlight = await orders.findLatestInFlight(customer.id);
    if (inFlight) {
      return `Your laundry is already with us, so that one can't be cancelled. It'll be back within ${site.turnaround}.`;
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
const WASH_FIELDS = ['water_temp', 'detergent', 'fabric_softener'];

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
  'detergent',
  'fabric_softener',
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
    const { error } = await db.from('customers').update({ [field]: stored }).eq('id', customer.id);
    if (error) throw error;
    return `Done, that's saved.`;
  }

  if (PREFERENCE_KEYS.includes(field)) {
    const preferences = { ...(customer.preferences || {}) };
    preferences[field] =
      field === 'fabric_softener' ? /^(yes|true|y|please)$/i.test(value) : value;

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

  if (['COLD', 'WARM', 'HOT'].includes(input.water_temp)) {
    prefs.water_temp = input.water_temp;
    prefsChanged = true;
  }
  if (['STANDARD', 'HYPOALLERGENIC'].includes(input.detergent)) {
    prefs.detergent = input.detergent;
    prefsChanged = true;
  }
  if (input.fabric_softener === 'yes' || input.fabric_softener === 'no') {
    prefs.fabric_softener = input.fabric_softener === 'yes';
    prefsChanged = true;
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

  const { data: updated, error } = await db
    .from('customers')
    .update(changes)
    .eq('id', customer.id)
    .select('*')
    .single();

  if (error) throw error;

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
      `Great. How do you like it washed: cold or warm water, regular or ` +
      `hypoallergenic detergent, and softener or no? And where should the ` +
      `driver find the bag?`
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
    `${billing.money(config.pricing.minimumCents)} minimum, back within ${site.turnaround}. ` +
    `When would you like your first pickup?`
  );
}

// --- set_pickup_schedule ----------------------------------------------------

async function setPickupSchedule(customer, input) {
  const first = String(customer.name || '').trim().split(/\s+/)[0];

  // Skipping one, or pausing for a while, without touching the cadence.
  if (input.skip_next || input.pause_until) {
    if (!recurring.isScheduled(customer)) {
      return `You haven't got a repeating pickup set up, so there's nothing to skip.`;
    }

    // "Skip this week" means pause up to and including the next one.
    const until = input.pause_until || recurring.nextDate(customer);
    const updated = await recurring.pauseUntil(customer, until);

    return (
      `No problem, skipped. Your next one is ${booking.readableDate(recurring.nextDate(updated))}. ` +
      `Text me any time if you want one sooner.`
    );
  }

  if (input.cadence === 'OFF') {
    if (!recurring.isScheduled(customer)) {
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

  const updated = await recurring.setSchedule(customer, { cadence: input.cadence, weekday });
  const next = recurring.nextDate(updated);

  // No mention of a total, because there isn't one: a schedule costs nothing
  // and each pickup is priced by weight exactly as it always was.
  return (
    `Sorted${first ? `, ${first}` : ''}! We'll come ${recurring.describe(updated)} from now on, ` +
    `starting ${booking.readableDate(next)}. We'll text you the day before each one, ` +
    `and you can skip a week or stop any time by texting me.`
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
      return cancelOrder(customer);
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
