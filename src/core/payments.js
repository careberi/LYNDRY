'use strict';

// ---------------------------------------------------------------------------
// HOW AN ORDER WAS ACTUALLY PAID.
//
// Neil, 14 September. Cash is not a payment method in this business: a
// customer cannot choose it, it is not on the checkout, and it is not on the
// driver's route. It is an admin option in exactly one situation - the card was
// refused, we are holding the laundry, and money is still owed.
//
// THE LEDGER IS THE RECORD AND orders.amount_paid_cents IS A SUM OF IT. Same
// relationship orders.weight_lb has with the bag weights: recomputed on every
// write rather than incremented, so it cannot drift. It exists because
// dispatch.balance() is called inside filters on every board and every run,
// and a query per row there would be thirty round trips to draw one screen.
//
// THERE IS NO CASH STATUS. An order settled partly in cash reads PAID, because
// it is paid; these rows say how. A CASH status would claim the whole order
// was cash when only the leftover was, and it would sit beside WAIVED, which
// means the opposite thing - a decision not to charge at all.
//
// NOTHING HERE SENDS A TEXT. Same rule as orders.transition(): the caller
// decides what the customer hears. For cash the answer is nothing - they were
// standing there when they handed it over.
// ---------------------------------------------------------------------------

const db = require('../db');
const orders = require('./orders');

const METHODS = Object.freeze({ CARD: 'CARD', CASH: 'CASH' });

const FIELDS =
  'id, order_id, customer_id, method, amount_cents, stripe_payment_intent_id, ' +
  'recorded_by, recorded_by_name, note, created_at';

function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

// Every payment on an order, oldest first, because a ledger reads forwards.
async function forOrder(orderId) {
  if (!orderId) return [];

  const { data, error } = await db
    .from('payments')
    .select(FIELDS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// Every payment across a set of orders, in one trip. For a screen listing many.
async function forOrders(orderIds = []) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await db.from('payments').select(FIELDS).in('order_id', ids);
  if (error) throw error;

  const byOrder = new Map();
  for (const row of data || []) {
    if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
    byOrder.get(row.order_id).push(row);
  }
  return byOrder;
}

// THE SPLIT, FOR A SCREEN. Pure: hand it an order and its rows.
//
// Neil's wording: the order must not say "Paid - Cash". It says
// Total $95 / Card $80 / Cash $15 / Balance $0 - Paid.
//
// `ledger` is false when there are no rows at all, which is every order taken
// before this existed. A screen shows the split only then it has one, rather
// than drawing Card $0 / Cash $0 over an order that was plainly paid by card.
function splitFor(order, rows = []) {
  const total = Number((order && order.price_cents) || 0);

  let card = 0;
  let cash = 0;
  for (const r of rows || []) {
    if (r.method === METHODS.CASH) cash += Number(r.amount_cents || 0);
    else card += Number(r.amount_cents || 0);
  }

  const paid = card + cash;

  return {
    ledger: (rows || []).length > 0,
    total,
    card,
    cash,
    paid,
    balance: Math.max(0, total - paid),
    settled: total > 0 && paid >= total,
    money,
  };
}

// Recompute the cached sum from the rows, and settle the order if it is covered.
//
// THE SUM IS READ BACK, NOT ADDED UP IN MEMORY. Two people recording cash at
// once would otherwise each write their own idea of the total.
async function resettle(order) {
  const rows = await forOrder(order.id);
  const paid = rows.reduce((sum, r) => sum + Number(r.amount_cents || 0), 0);
  const total = Number(order.price_cents || 0);

  const patch = { amount_paid_cents: paid };

  // COVERED MEANS PAID, AND THAT IS THE ONLY STATUS THIS EVER WRITES.
  //
  // Not when it is partly covered: an order with $15 still owed stays FAILED,
  // which is what keeps dispatch.paymentHold() true and the laundry off a
  // doorstep. Neil's rule - do not clear the hold until the remaining balance
  // is nothing.
  if (total > 0 && paid >= total) {
    patch.payment_status = 'PAID';
    patch.paid_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from('orders')
    .update(patch)
    .eq('id', order.id)
    .select('*')
    .single();

  if (error) throw error;
  return { order: data, rows, paid, settled: Boolean(patch.payment_status) };
}

// A CARD CHARGE THAT WENT THROUGH. Written by billing, not by a person.
async function recordCard(order, { amountCents, paymentIntentId, note = null } = {}) {
  const amount = Math.round(Number(amountCents || 0));
  if (!order || !order.id || !amount) return null;

  const { error } = await db.from('payments').insert({
    order_id: order.id,
    customer_id: order.customer_id || null,
    method: METHODS.CARD,
    amount_cents: amount,
    stripe_payment_intent_id: paymentIntentId || null,
    note,
  });

  // BEST EFFORT, AND IT MUST NOT UNDO THE CHARGE. The money has already moved
  // at this point; failing to write the ledger row is a reporting problem and
  // losing the charge would be a real one.
  if (error) {
    console.error(`Could not record a card payment on ${order.id}: ${error.message}`);
    return null;
  }

  return resettle(order).catch((err) => {
    console.error(`Could not resettle ${order.id} after a card payment: ${err.message}`);
    return null;
  });
}

// ---------------------------------------------------------------------------
// CASH, HANDED OVER, RECORDED BY A PERSON.
//
// Every refusal below is one of Neil's rules, checked here rather than only in
// the form - a screen that hides a control while the route behind it still
// fires is not a guard, and this route can be posted to directly.
// ---------------------------------------------------------------------------
async function recordCash(order, { amountCents, by = {}, note = null } = {}) {
  if (!order || !order.id) return { ok: false, reason: 'no_order' };

  // ONLY AFTER A CARD HAS BEEN REFUSED. Cash is a recovery, not a way to pay.
  // An UNPAID order is one nobody has tried to charge yet, and offering cash
  // there would make it a checkout option by the back door.
  if (order.payment_status !== 'FAILED') {
    return { ok: false, reason: 'not_failed' };
  }

  // ONLY WHILE WE ARE HOLDING THE LAUNDRY. This is the Payment Hold condition,
  // and it is asked through the same list dispatch uses so the two cannot
  // disagree about what "in our hands" means.
  if (!orders.IN_OUR_HANDS.includes(order.status)) {
    return { ok: false, reason: 'not_in_our_hands' };
  }

  const total = Number(order.price_cents || 0);
  const already = Number(order.amount_paid_cents || 0);
  const outstanding = Math.max(0, total - already);

  if (outstanding <= 0) return { ok: false, reason: 'nothing_owed' };

  const amount = Math.round(Number(amountCents || 0));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'bad_amount' };
  }

  // THE REMAINING BALANCE ONLY. Neil's rule, and the reason is that anything
  // more is not a payment, it is change owed - which this system has no way to
  // give back and no business pretending to hold.
  if (amount > outstanding) {
    return { ok: false, reason: 'more_than_owed', outstanding };
  }

  const { error } = await db.from('payments').insert({
    order_id: order.id,
    customer_id: order.customer_id || null,
    method: METHODS.CASH,
    amount_cents: amount,
    recorded_by: by.opsUser && !by.opsUser.isMachine ? by.opsUser.id : null,
    // The name as well, because an ops_users row can be disabled or renamed and
    // the ledger has to keep saying who it was at the time.
    recorded_by_name: (by.opsUser && by.opsUser.name) || by.actor || 'staff',
    note: note ? String(note).slice(0, 300) : null,
  });

  if (error) throw error;

  const after = await resettle(order);

  return {
    ok: true,
    order: after.order,
    rows: after.rows,
    amount,
    settled: after.settled,
    // What is left after this one. Zero means the hold has just cleared.
    outstanding: Math.max(0, total - after.paid),
  };
}

module.exports = {
  METHODS,
  FIELDS,
  money,
  forOrder,
  forOrders,
  splitFor,
  resettle,
  recordCard,
  recordCash,
};
