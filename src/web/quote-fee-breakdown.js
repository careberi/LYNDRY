 'use strict';
// Display allocation only: these rows split the existing saved fee, never add to it.
// Legacy quotes retain the meaning of their original fee.
module.exports = function feeBreakdown(snapshot) {
  const total = snapshot.operationalFeeCents;
  if (snapshot.pricingMethod !== 'COST_PLUS_MARGIN_15') return [['Operational fee', total]];
  const transport = snapshot.courierCents ?? ((snapshot.pickupCents || 0) + (snapshot.returnCents || 0));
  const allocationBps = snapshot.policy?.operationalFeeBps ?? 2500;
  // Very low or waived transportation must not produce a negative delivery line.
  const service = Math.min(200, total);
  const operations = Math.min(Math.round(transport * allocationBps / 10000), total - service);
  return [['Delivery', total - operations - service], ['Operational fee', operations], ['Service fee', service]];
};
