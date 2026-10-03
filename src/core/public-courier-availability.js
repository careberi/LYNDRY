'use strict';

// Public and booking prices use the same address-only offers in each direction.
// Scheduled availability is checked separately and cannot replace that price.
// One available supported courier is sufficient. This is an availability check only:
// it never creates an order or requests a driver.
const REQUIRED_SERVICES = Object.freeze(['uber', 'doordash']);

function serviceKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function requiredFee(quote, required = REQUIRED_SERVICES) {
  if (!quote || quote.ok !== true || !Array.isArray(quote.options)) return null;
  const fees = quote.options.filter(option=>required.some(name=>serviceKey(option.service).includes(serviceKey(name))) &&
    !option.requiresFeeReview && Number.isSafeInteger(option.feeCents) && option.feeCents>=0).map(option=>option.feeCents);
  return fees.length ? Math.min(...fees) : null;
}

async function verifyRoundTrip(client, { customer, partner, pickupReadyAt, acceptArrival, onUnavailable = () => {} }) {
  const [pickup, returned, scheduled] = await Promise.all([
    client.quote({ from: customer, to: partner }),
    client.quote({ from: partner, to: customer }),
    ...(pickupReadyAt ? [client.quote({ from: customer, to: partner, pickupReadyAt })] : []),
  ]);
  if([pickup,returned,scheduled].some(q=>q?.reason==='pickup_time_rejected'))throw Object.assign(Error('The courier rejected this pickup time. Choose a later time and refresh the quote.'),{code:'PICKUP_TIME_REJECTED'});
  const pickupCents = requiredFee(pickup);
  const returnCents = requiredFee(returned);
  if (pickupCents === null || returnCents === null) { onUnavailable('courier_unavailable'); return null; }
  let arrivals,pickupEstimateAt;
  if(pickupReadyAt) {
    if(requiredFee(scheduled)===null) { onUnavailable('courier_unavailable'); return null; }
    const usable=scheduled.options.filter(r=>/uber|doordash/i.test(r.service||'')&&Date.parse(r.pickupTime)>=Date.parse(pickupReadyAt)&&
      Date.parse(r.pickupTime)<=Date.parse(pickupReadyAt)+30*60000&&Date.parse(r.deliveryTime)>Date.parse(r.pickupTime));
    if(!usable.length) { onUnavailable('arrival_estimate'); return null; }
    const fitting = usable.filter(r=>!acceptArrival||acceptArrival(r.deliveryTime));
    const scheduledFee=requiredFee({...scheduled,options:fitting});
    if(scheduledFee===null) { onUnavailable('arrival_hours'); return null; }
    const selected=fitting.find(r=>!r.requiresFeeReview&&r.feeCents===scheduledFee);
    arrivals=[selected.deliveryTime];
    pickupEstimateAt=selected.pickupTime;
  }
  const expiries = [pickup.expiresAt, returned.expiresAt,...(pickupReadyAt?[scheduled.expiresAt]:[])]
    .map(Date.parse).filter(Number.isFinite);
  if (expiries.length !== (pickupReadyAt?3:2) || Math.min(...expiries)<=Date.now()) throw Error('Shipday did not return fresh courier estimates.');
  return {
    pickupCents,
    returnCents,
    source: 'SHIPDAY',
    expiresAt: new Date(Math.min(...expiries)).toISOString(),
    ...(arrivals?{arrivalChecks:arrivals}:{}),
    ...(pickupEstimateAt?{pickupEstimateAt}:{}),
  };
}

module.exports = { REQUIRED_SERVICES, serviceKey, requiredFee, verifyRoundTrip };
