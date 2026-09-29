'use strict';

const { quotedTotal } = require('./pricing-economics');
const MODES = ['FIXED', 'MINIMUM', 'MAXIMUM'];

function validate(policy) {
  if (!policy || !MODES.includes(policy.mode)) throw Error('Choose a card hold method.');
  if (policy.mode === 'FIXED' && (!Number.isSafeInteger(policy.fixedCents) || policy.fixedCents < 50 || policy.fixedCents > 1000000)) {
    throw Error('Enter a fixed hold between $0.50 and $10,000.00.');
  }
  return policy;
}

function amount(snapshot, policy = snapshot?.policy?.cardHold) {
  validate(policy);
  if (policy.mode === 'FIXED') return policy.fixedCents;
  if (policy.mode === 'MINIMUM') {
    if (!Number.isSafeInteger(snapshot?.minimumTotalCents) || snapshot.minimumTotalCents < 50) throw Error('This order has no valid minimum for its card hold.');
    return snapshot.minimumTotalCents;
  }
  // The order weight ceiling is 50 lb; include the fee once and respect the minimum.
  return quotedTotal({ ...snapshot, weightLb: 50 });
}

function fromForm(form) {
  const mode = String(form.hold_mode || '');
  const text = String(form.hold_fixed || '').trim();
  if (mode === 'FIXED' && !/^\d+(?:\.\d{1,2})?$/.test(text)) throw Error('Enter the fixed hold in dollars, with no more than two decimal places.');
  return validate(mode === 'FIXED' ? { mode, fixedCents: Math.round(Number(text) * 100) } : { mode });
}

module.exports = { validate, amount, fromForm };
