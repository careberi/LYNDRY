'use strict';

const { config } = require('../config');

// ---------------------------------------------------------------------------
// WHO DOES EACH LEG OF AN ORDER.
//
// Neil, 25 September: "There also needs for me to override a pickup/delivery
// manually so i can assign a in house driver to it".
//
// TWO ANSWERS, `COURIER` AND `DRIVER`, and one question asked in one place. The
// alternative is `if (order.return_carrier === 'DRIVER')` written into the
// portal, the run, the routing board and the order page - which is how a screen
// ends up disagreeing with the route behind it, the exact thing `roles.js`
// exists to prevent for permissions.
//
// THE DEFAULT IS DERIVED, NEVER STORED. Under the van a driver does both legs;
// under the courier model a courier does. Writing the default onto every order
// would be a second copy of a fact `config.courier.model` already holds, and it
// would go stale the day the model changes.
//
// SO A VALUE ON THE ORDER ALWAYS MEANS SOMEBODY DECIDED, which is what makes it
// safe for a screen to say "chosen by hand" without a second column recording
// that it was.
//
// EVERYTHING HERE IS PURE. Nothing reads a database, so every rule below is
// testable - which matters because the wrong answer either sends a courier to
// collect bags a driver is already on the way for, or leaves a customer waiting
// for a van nobody dispatched.
// ---------------------------------------------------------------------------

const COURIER = 'COURIER';
const DRIVER = 'DRIVER';

const CARRIERS = Object.freeze([COURIER, DRIVER]);

// The two legs, named the way `courier_deliveries.leg` names them so one
// vocabulary covers the column, the table and the screens.
const PICKUP = 'TO_PARTNER';
const RETURN = 'TO_CUSTOMER';

// Which column on the order holds the override for a leg.
const COLUMN = Object.freeze({
  [PICKUP]: 'pickup_carrier',
  [RETURN]: 'return_carrier',
});

// WHAT HAPPENS IF NOBODY SAYS. Under the van, one of ours drives both ways -
// which is every order in production today. Under the courier model, a courier
// does, which is the whole point of the model.
function defaultCarrier() {
  return config.courier.model === 'DYNAMIC' ? COURIER : DRIVER;
}

// WHO IS DOING THIS LEG.
//
// `leg` is `TO_PARTNER` or `TO_CUSTOMER`. An unrecognised leg answers with the
// default rather than throwing: a caller asking about a leg that does not exist
// is a bug, and refusing to answer would turn it into an outage on a screen
// somebody is standing in front of.
function carrierFor(order, leg) {
  const column = COLUMN[leg];
  if (!column) return defaultCarrier();

  const chosen = String((order || {})[column] || '').toUpperCase();
  return CARRIERS.includes(chosen) ? chosen : defaultCarrier();
}

// DID A PERSON CHOOSE THIS, or is it just what the model does? Screens say
// "chosen by hand" off this, the same way the routing board does for a pinned
// laundromat.
function chosenByHand(order, leg) {
  const column = COLUMN[leg];
  if (!column) return false;

  return CARRIERS.includes(String((order || {})[column] || '').toUpperCase());
}

const isCourier = (order, leg) => carrierFor(order, leg) === COURIER;
const isDriver = (order, leg) => carrierFor(order, leg) === DRIVER;

// --- what a screen is allowed to offer --------------------------------------

// MAY A COURIER BE SENT FOR THE FINISHED WORK.
//
// Asked by the laundromat portal before it draws its button, and again by the
// route behind it - because a screen that hides a control while the route still
// fires is not a guard, and this one spends money at a vendor.
//
// THE REASON IS RETURNED, not just a boolean, because the attendant is told it.
// "Nothing happened" on a counter gets somebody ringing the office.
function mayBookReturnCourier(order) {
  if (!order) return { ok: false, reason: 'no_order' };

  if (isDriver(order, RETURN)) {
    // NEIL SAID HE IS DRIVING THIS ONE. A courier booked here would be a second
    // vehicle sent for bags somebody is already on the way for, and we would pay
    // for it.
    return { ok: false, reason: 'ours_to_drive' };
  }

  // THE WEIGHT IS WHAT BILLS. Under the courier model the laundromat's scale is
  // the only scale there is, so the bags must not leave the counter before it
  // has said something.
  if (order.partner_weight_lb == null) return { ok: false, reason: 'not_weighed' };

  // A DECLINED CARD REFUSES THE DELIVERY, AND THIS GATE WAS MISSING.
  //
  // CLAUDE.md's lock is per LEG, and the courier return IS the delivery leg:
  // retrieval off a laundromat is allowed while held, because refusing it leaves
  // our bags on somebody else's shelf at their cost, and the delivery to the
  // customer's door is refused. `outForDelivery()` and `deliver()` both enforce
  // it - and this function, which is the only thing standing between a declined
  // card and an Uber courier, did not.
  //
  // IT IS REACHABLE AND NOT THEORETICAL. Under a courier the card is charged at
  // the weigh-in, and a decline there calls `markFailed()`, which writes
  // `payment_status = 'FAILED'`. The attendant's very next action is this button.
  // So the sequence "scale says 28 lb, card says no, send a courier" was one tap
  // and would have driven somebody's laundry to their door unpaid, past a hold
  // two other functions were carefully written to respect.
  //
  // THE SAME CHECK `deliver()` MAKES, NOT A STRICTER ONE. `paymentHold()` is pure
  // and reads the order alone. The customer-level SIBLING block - one unsettled
  // order parking their others - is `heldCustomerIds()`, one async query owned by
  // the board, and `deliver()` does not ask it either. Matching the existing gate
  // exactly is right; inventing a stricter one here would be a second rule.
  //
  // Required inside the function, not at the top: `dispatch` reaches for
  // `billing`, which reaches back for `dispatch`, and this module is otherwise a
  // pure rules file that the portal, the run and the order page all load.
  const dispatch = require('./dispatch');
  if (dispatch.paymentHold(order)) return { ok: false, reason: 'payment_hold' };

  return { ok: true };
}

module.exports = {
  COURIER,
  DRIVER,
  CARRIERS,
  PICKUP,
  RETURN,
  COLUMN,

  defaultCarrier,
  carrierFor,
  chosenByHand,
  isCourier,
  isDriver,
  mayBookReturnCourier,
};
