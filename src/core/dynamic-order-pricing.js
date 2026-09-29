'use strict';

const economics = require('./pricing-economics');

// Quotes retain their policy and costs. Later policy edits apply only to new quotes.
function quoteCandidates(candidates, { policy, category, now = Date.now() }) {
  economics.validatePolicy(policy, category);
  if (!candidates.length) throw Error('No eligible laundromat is available for this pickup.');
  for (const candidate of candidates) {
    if (!candidate.eligible) throw Error('The comparison contains an ineligible laundromat.');
    if (!Number.isFinite(Date.parse(candidate.expiresAt)) || Date.parse(candidate.expiresAt) <= now) {
      throw Error('Refresh both courier estimates before comparing prices.');
    }
    if (!['SIMULATION', 'SHIPDAY'].includes(candidate.source)) throw Error('Courier estimate source is missing.');
  }
  const ranked = economics.compareCandidates(candidates, { policy, category });
  const winner = candidates.find(candidate => candidate.id === ranked[0].id);
  return {
    ...ranked[0], policy: structuredClone(policy), partnerId: winner.id,
    wholesaleCentsPerLb: winner.wholesaleCentsPerLb,
    pickupCents: winner.pickupCents, returnCents: winner.returnCents,
    source: winner.source, expiresAt: winner.expiresAt,
    ...(winner.arrivalChecks?{arrivalChecks:winner.arrivalChecks}:{}),
    comparisons: ranked.map(row => ({ partnerId: row.id, totalCents: row.estimatedReferenceTotalCents })),
  };
}

function assessWeight(snapshot, { weightLb, pickupCents, returnCents }) {
  if (!Number.isFinite(weightLb) || weightLb <= 0 || weightLb > 50) throw Error('Enter an order weight greater than zero and no more than 50 lb.');
  const totalCents = economics.quotedTotal({...snapshot,weightLb});
  const requiredTotalCents = economics.requiredTotal({...snapshot,weightLb,pickupCents,returnCents});
  // Cost variance belongs in operations reporting, not a second customer approval.
  return {totalCents,lockedTotalCents:totalCents,requiredTotalCents,belowTarget:requiredTotalCents>totalCents};
}

module.exports = { quoteCandidates, assessWeight };
