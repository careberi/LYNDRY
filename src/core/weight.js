'use strict';

// ---------------------------------------------------------------------------
// POUNDS, ROUNDED THE ONE WAY.
//
// The board showed "52.599999999999994 lb". Nothing was wrong with the scale:
// 25 + 27.6 in binary floating point is 52.599999999999994, and every total in
// this system is a sum of bag weights. Add three or four bags and the error
// surfaces in the fifteenth decimal place, which is where a number stops
// looking like a weight and starts looking like a bug.
//
// TWO DECIMALS, AND ALWAYS UP. Neil's rule. Up rather than nearest, so a weight
// is never rounded DOWN - a bag can be worth a fraction of a cent more than we
// charged, never less, and a laundromat is never invoiced for less than they
// washed. It also means the drift above can only ever resolve upward, which is
// the safe direction for both.
//
// USED AT EVERY SUM, not only at the point of display. A total that is right on
// screen and wrong in the column behind it is worse than one that is visibly
// wrong, because the visible one gets fixed.
// ---------------------------------------------------------------------------

// How many decimal places a weight is allowed. Two, because a scale that reads
// to a hundredth of a pound is already finer than the ones in a laundromat.
const PLACES = 2;
const FACTOR = 10 ** PLACES;

// Round a weight UP to two decimals. Null and anything unparseable come back as
// null rather than 0 - an unweighed bag has no weight, and a zero would put a
// real-looking number into a total somebody is about to invoice against.
function lb(value) {
  // Empty string is not zero. Number('') is 0, which would turn an unweighed
  // bag into a real-looking 0.00 in a column somebody invoices against - the
  // exact thing the null check above exists to prevent.
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  // The epsilon matters. Math.ceil(52.6 * 100) on a value that is really
  // 52.60000000000001 gives 5261, turning an exact weight into 52.61 - so a
  // number that is within a hair of the boundary is nudged onto it first.
  // Without this, rounding up would invent a hundredth of a pound on totals
  // that were already correct.
  const scaled = n * FACTOR;
  const nudged = Math.abs(scaled - Math.round(scaled)) < 1e-6 ? Math.round(scaled) : Math.ceil(scaled);

  return nudged / FACTOR;
}

// Add up a list of weights and round once, at the end. Rounding each item and
// then summing compounds the correction - four bags rounded up individually can
// add a whole two hundredths that nobody weighed.
function sum(values) {
  const total = (values || []).reduce((t, v) => {
    const n = Number(v);
    return t + (Number.isFinite(n) ? n : 0);
  }, 0);

  return lb(total);
}

// For a screen: a fixed two decimals, so a column of weights lines up. Takes
// the rounding above first, so what is shown and what is stored agree.
function show(value, { unit = false } = {}) {
  const n = lb(value);
  if (n == null) return unit ? '-' : '-';
  return `${n.toFixed(PLACES)}${unit ? ' lb' : ''}`;
}

module.exports = { lb, sum, show, PLACES };
