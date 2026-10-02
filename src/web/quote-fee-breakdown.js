 'use strict';
// Display allocation only: these rows split the existing saved fee, never add to it.
// Legacy quotes retain the meaning of their original fee.
module.exports = function feeBreakdown(snapshot) {
  if (require('../core/weight-based-pricing').isSnapshot(snapshot)) return [];
  const total = snapshot.operationalFeeCents;
  if (snapshot.pricingMethod !== 'COST_PLUS_MARGIN_15') return [['Operational fee', total]];
  const transport = snapshot.courierCents ?? ((snapshot.pickupCents || 0) + (snapshot.returnCents || 0));
  const allocationBps = snapshot.policy?.operationalFeeBps ?? 2500;
  // Very low or waived transportation must not produce a negative delivery line.
  const revised = snapshot.feeCalculation === 'TRANSPORT_MARGIN_V2';
  const service = Math.min(revised ? 199 : 200, total);
  const operations = Math.min(Math.round((revised ? total : transport) * allocationBps / 10000), total - service);
  return [['Delivery', total - operations - service], ['Operational fee', operations], ['Service fee', service]];
};
