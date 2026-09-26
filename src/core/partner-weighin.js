'use strict';

const db = require('../db');
const orderEvents = require('./order-events');
const issues = require('./issues');

// ---------------------------------------------------------------------------
// THE LAUNDROMAT'S OWN WEIGHT, RECORDED THE ONE WAY.
//
// There are two doors onto this now and there will be a third:
//
//   /o/<code>          the bag tag, no sign-in, a camera pointed at a sticker
//   /shop              the portal, signed in, an attendant at a counter
//
// It was written inline in the bag route while there was one of them. The moment
// a second appeared, reimplementing "the laundromat weighed it" in the portal
// would have drifted the first time one of them learned something the other did
// not - the same rule `fulfilment.js` and `booking.js` already follow for their
// two front doors, and the reason this file exists at all.
//
// WHAT IT DOES, IN ORDER, AND THE ORDER MATTERS: store the figure, write the
// audit entry, then settle. Settling is what prices the order and may charge a
// card, so it goes last and behind the record of the number it used.
//
// IT DOES NOT SETTLE ITSELF. `fulfilment.settleWeight()` is passed in by the
// caller, because requiring `fulfilment` here would close a loop -
// fulfilment -> ... -> partner-weighin -> fulfilment - and CLAUDE.md records
// exactly what that costs: a module in a loop gets `{}` at boot, for good, and
// nothing errors. A lazy require inside the function is the documented
// alternative and would work; handing it in is simpler to read and impossible to
// get wrong.
// ---------------------------------------------------------------------------

// The most a load can plausibly weigh. Higher than a single bag's 200 because
// this is the whole order on one scale.
const MAX_LOAD_LB = 400;

function looksLikeAWeight(weightLb, max = MAX_LOAD_LB) {
  const weight = Number(weightLb);
  return Number.isFinite(weight) && weight > 0 && weight <= max;
}

// WHAT THEY WEIGHED, FOR THE WHOLE ORDER.
//
// Which is what a laundromat actually has: they weigh what goes in the machine,
// not each bag we carried it in.
//
// `settleWeight` is `fulfilment.settleWeight`, passed in. `by` says who did it,
// and it is not decorative - it is what an order's change log shows afterwards,
// and "the laundromat" and "Maria at Riverside" are different answers.
async function recordWholeLoad({ order, weightLb, by, settleWeight }) {
  const weight = Number(weightLb);

  if (!looksLikeAWeight(weight)) {
    return { ok: false, reason: 'bad_weight' };
  }

  // NOT UNTIL THE BAGS ARE ACTUALLY WITH THEM. The same guard both pages draw
  // their form behind - and it is checked here because a form that is merely
  // absent from the markup guards nothing, on the tag page least of all, which
  // has no sign-in.
  if (order.status !== 'AT_PARTNER') {
    return { ok: false, reason: 'not_here_yet' };
  }

  const { error } = await db
    .from('orders')
    .update({ partner_weight_lb: weight, partner_weight_at: new Date().toISOString() })
    .eq('id', order.id);

  if (error) throw error;

  await orderEvents.record(order.id, {
    kind: 'PARTNER_WEIGHT',
    summary: `Laundromat weighed the whole load at ${weight.toFixed(1)} lb`,
    was: order.weight_lb == null ? null : `${order.weight_lb} lb ours`,
    became: `${weight.toFixed(1)} lb theirs`,
    by,
  });

  // SETTLING MUST NOT BE ABLE TO LOSE THE WEIGHT. The figure and its audit entry
  // are already written, so a settle that throws leaves a recorded weight and an
  // unsettled order - which the order page offers to re-run. The other way round
  // would lose the one number an attendant actually typed.
  const settled = await settleWeight(
    { ...order, partner_weight_lb: weight },
    { by }
  ).catch((err) => {
    console.error(`Could not settle order ${order.id} after the laundromat weighed it: ${err.message}`);
    return { ok: false, failed: true };
  });

  // THE SCALES DISAGREE, so nothing has been charged and the customer has been
  // told no price. An issue rather than a quiet log, because the only way out is
  // a person deciding which number is right.
  if (settled && settled.held) {
    // THE CUSTOMER IS LOOKED UP HERE, NOT TAKEN FROM THE CALLER, and that is the
    // fix for a real silent failure.
    //
    // The laundromat portal deliberately never loads a customer's name, phone or
    // address - an attendant has no reason for any of it. So the order it hands
    // in carries `customers(preferences)` and nothing else, `issues.raise()` got
    // an object with no id and no phone, and THE ISSUE WAS NEVER RAISED. The
    // weight held, the price was not charged, and nobody was told - which is the
    // one outcome this branch exists to prevent.
    //
    // Fetching it here means the caller is free to select as little as it likes,
    // which is what lets the portal keep its rule.
    const customer = await customerFor(order);

    await issues
      .raise({
        customer,
        order,
        reason:
          `Scales disagree: we weighed it ${order.weight_lb} lb, the laundromat ` +
          `${weight.toFixed(1)} lb. NOTHING HAS BEEN CHARGED and the customer has ` +
          `not been told a price. Settle it on the order page and both happen then.`,
      })
      .catch((err) => console.error(`Could not raise a weight mismatch: ${err.message}`));
  }

  return { ok: true, weight, settled };
}

// The customer an issue has to name, however little the caller selected.
//
// A joined `customers(...)` on the order is used when it is actually there and
// carries an id; anything less is re-read. Returns null rather than throwing -
// an issue with no customer on it is worse than one with, and far better than
// none at all, so a failure here must not swallow the whole escalation.
async function customerFor(order) {
  const joined = order && order.customers;
  if (joined && joined.id && joined.phone) return joined;

  if (!order || !order.customer_id) {
    // An order with no customer is a real state - a row written by hand, a seed.
    // The issue is still raised; it simply names nobody.
    return joined || null;
  }

  const { data, error } = await db
    .from('customers')
    .select('id, name, phone')
    .eq('id', order.customer_id)
    .maybeSingle();

  if (error) {
    console.error(`Could not load the customer to raise a weight mismatch: ${error.message}`);
    return joined || null;
  }

  return data || joined || null;
}

module.exports = {
  MAX_LOAD_LB,
  looksLikeAWeight,
  recordWholeLoad,
};
