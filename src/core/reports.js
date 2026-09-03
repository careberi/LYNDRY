'use strict';

const db = require('../db');
const wash = require('./wash');
const booking = require('./booking');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// THE RECONCILIATION REPORT.
//
// One row per order, laying the three weights side by side with the money that
// came out of them. It answers the question nobody could answer before without
// opening orders one at a time: for this laundromat, over these days, what did
// we weigh, what did they say, what came back, what did we charge, and what
// will they invoice us.
//
// EVERY FIGURE IS READ, NOT RECOMPUTED, wherever a stored one exists. The price
// on an order is what the customer was actually charged, at the rate stored on
// that order - re-deriving it from today's rate would quietly restate history,
// which is the one thing a reconciliation report must never do.
//
// Two columns ARE derived, and they are the two that answer "should", not
// "did":
//
//   billedWeightLb    the heavier of ours and theirs, which is Neil's rule for
//                     what the customer pays on
//   partnerOwedCents  their weight at their wholesale rate
// ---------------------------------------------------------------------------

// The wash details this order was actually booked with, falling back to the
// customer row for orders taken before orders.preferences existed.
function prefsOf(order) {
  const own = order.preferences;
  if (own && Object.keys(own).length) return own;
  return (order.customers && order.customers.preferences) || {};
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(cents) {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

function rowFor(order) {
  const ours = num(order.weight_lb);
  const theirs = num(order.partner_weight_lb);
  const back = num(order.return_weight_lb);

  // NEIL'S RULE: the customer pays on the heavier of the two scales. Not an
  // average, and not ours by default - if their scale says more, that is what
  // was washed. When only one figure exists it is the only figure there is.
  const billedWeightLb =
    ours == null && theirs == null
      ? null
      : Math.max(ours == null ? 0 : ours, theirs == null ? 0 : theirs);

  // What the +$2 options come to.
  //
  // NOT part of price_cents today. Nothing in the pricing path has ever called
  // surchargeFor - the options are advertised to the customer and then never
  // billed - so this column sits next to what they were actually charged and
  // the gap is visible. That gap is a reason to have this report.
  const additionsCents = wash.surchargeFor(prefsOf(order));

  const rate = order.price_per_lb_cents || config.pricing.perPoundCents;
  const floor = order.minimum_cents != null ? order.minimum_cents : 0;

  // What this order WOULD cost on the billed weight at its own stored rate,
  // additions included. Shown beside the real charge so a difference shows up
  // rather than being assumed away.
  const expectedCents =
    billedWeightLb == null
      ? null
      : Math.max(Math.round(billedWeightLb * rate), floor) + additionsCents;

  const partner = order.partners || null;
  const wholesale = partner ? num(partner.wholesale_per_lb_cents) : null;

  // WE PAY ON THE LOWER OF THE TWO SCALES. Neil's rule, and it is the mirror of
  // the one above: "we're always gonna bill the customer the highest of the
  // two, but invoice the lowest of the two."
  //
  // It used to pay on THEIR figure whatever it was. That is the same answer
  // whenever their scale reads light - which is every case we have seen - and
  // the wrong one the first time a laundromat's scale reads heavy: we would
  // bill the customer on their number AND pay them on it, taking the loss at
  // both ends of the same bag.
  //
  // Both rules together mean a disagreement between two scales never costs us
  // money, and that is the point of asking two scales.
  const payWeightLb =
    ours == null && theirs == null
      ? null
      : Math.min(ours == null ? Infinity : ours, theirs == null ? Infinity : theirs);

  // Null when we lack their rate, or when they never weighed it - an invoice
  // line invented from our own scale alone is not a check on anything, which is
  // the whole reason we ask them to weigh it.
  const partnerOwedCents =
    theirs != null && wholesale != null && payWeightLb != null
      ? Math.round(payWeightLb * wholesale)
      : null;

  const charged = order.price_cents == null ? null : Number(order.price_cents);

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    date: order.pickup_date,

    partnerName: partner ? partner.name : null,
    partnerId: order.partner_id,

    ourWeightLb: ours,
    partnerWeightLb: theirs,
    returnWeightLb: back,

    // Their scale against ours. The SIGN matters and is kept: heavier and
    // lighter mean opposite things, and Math.abs would hide that.
    driftLb: ours != null && theirs != null ? Number((theirs - ours).toFixed(2)) : null,
    driftPct:
      ours && theirs != null ? Number((((theirs - ours) / ours) * 100).toFixed(1)) : null,

    additionsCents,
    billedWeightLb,
    expectedCents,
    chargedCents: charged,
    paid: order.payment_status === 'PAID',

    partnerRateCents: wholesale,
    payWeightLb: payWeightLb === Infinity ? null : payWeightLb,
    partnerOwedCents,

    // Charge minus the wash. NOT a margin - the routing board owns that, and it
    // counts the van and the wage. This is the two numbers on this row.
    grossCents: charged != null && partnerOwedCents != null ? charged - partnerOwedCents : null,
  };
}

// `from` and `to` are ISO dates, inclusive. Defaults to the last 30 days: a
// month of trading rather than an arbitrary page size.
async function rows({ from = null, to = null, partnerId = null } = {}) {
  const end = to || booking.today();
  const start = from || booking.addDays(end, -30);

  let query = db
    .from('orders')
    .select(
      'id, order_number, status, pickup_date, weight_lb, partner_weight_lb, ' +
        'return_weight_lb, price_cents, price_per_lb_cents, minimum_cents, payment_status, ' +
        // NAMED RELATIONSHIP, because orders points at partners TWICE - partner_id
        // is where the bag actually went and intended_partner_id is where it was
        // planned to go when it was booked. An unqualified embed is ambiguous and
        // Postgrest refuses it; guessing would have reported the plan as the fact.
        'preferences, partner_id, partners!partner_id(id, name, wholesale_per_lb_cents), customers(preferences)'
    )
    .gte('pickup_date', start)
    .lte('pickup_date', end)
    .neq('status', 'CANCELED')
    .order('pickup_date', { ascending: false })
    .order('order_number', { ascending: false });

  if (partnerId) query = query.eq('partner_id', partnerId);

  const { data, error } = await query;
  if (error) throw error;

  return { start, end, rows: (data || []).map(rowFor) };
}

// Column totals. NULLS ARE SKIPPED, NOT COUNTED AS ZERO - an order nobody has
// weighed is missing from that total rather than worth nothing in it, and the
// count of how many is what says whether the total can be trusted.
function totals(list) {
  const sum = (pick) => list.reduce((t, r) => (pick(r) == null ? t : t + pick(r)), 0);
  const known = (pick) => list.filter((r) => pick(r) != null).length;

  return {
    orders: list.length,
    weighed: known((r) => r.ourWeightLb),
    partnerWeighed: known((r) => r.partnerWeightLb),
    priced: known((r) => r.chargedCents),
    invoiceable: known((r) => r.partnerOwedCents),

    ourWeightLb: Number(sum((r) => r.ourWeightLb).toFixed(2)),
    partnerWeightLb: Number(sum((r) => r.partnerWeightLb).toFixed(2)),
    returnWeightLb: Number(sum((r) => r.returnWeightLb).toFixed(2)),
    billedWeightLb: Number(sum((r) => r.billedWeightLb).toFixed(2)),
    payWeightLb: Number(sum((r) => r.payWeightLb).toFixed(2)),

    additionsCents: sum((r) => r.additionsCents),
    chargedCents: sum((r) => r.chargedCents),
    expectedCents: sum((r) => r.expectedCents),
    partnerOwedCents: sum((r) => r.partnerOwedCents),
    grossCents: sum((r) => r.grossCents),
  };
}

const CSV_COLUMNS = Object.freeze([
  ['Laundromat', (r) => r.partnerName || ''],
  ['Order', (r) => r.orderNumber],
  ['Pickup date', (r) => r.date || ''],
  ['Status', (r) => r.status],
  ['LYNDRY weight lb', (r) => r.ourWeightLb],
  ['Partner weight lb', (r) => r.partnerWeightLb],
  ['Weight back out lb', (r) => r.returnWeightLb],
  ['Drift lb', (r) => r.driftLb],
  ['Additions', (r) => money(r.additionsCents)],
  ['Billed on higher lb', (r) => r.billedWeightLb],
  ['Charged to customer', (r) => money(r.chargedCents)],
  ['Expected charge', (r) => money(r.expectedCents)],
  ['We pay on lower lb', (r) => r.payWeightLb],
  ['Laundromat rate per lb', (r) => money(r.partnerRateCents)],
  ['We pay partner', (r) => money(r.partnerOwedCents)],
  ['Charge minus wash', (r) => money(r.grossCents)],
]);

// EXCEL EATS LEADING ZEROS AND TURNS THINGS INTO DATES, so every field is
// quoted and every quote inside is doubled. A laundromat with an apostrophe in
// its name is an ordinary thing and must not break the file.
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(list) {
  const head = CSV_COLUMNS.map(([label]) => csvCell(label)).join(',');
  const body = list.map((r) => CSV_COLUMNS.map(([, pick]) => csvCell(pick(r))).join(','));
  // CRLF, because that is what Excel expects and it costs nothing.
  return [head, ...body].join('\r\n');
}

module.exports = { rows, rowFor, totals, toCsv, money, CSV_COLUMNS };
