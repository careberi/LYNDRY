'use strict';

// A public price is only shown when Shipday can currently price both supported
// third-party couriers in both directions. This is an availability check only:
// it never creates an order or requests a driver.
const REQUIRED_SERVICES = Object.freeze(['uber', 'doordash']);

function serviceKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function requiredFee(quote, required = REQUIRED_SERVICES) {
  if (!quote || quote.ok !== true || !Array.isArray(quote.options)) return null;
  const fees = required.map((name) => {
    const match = quote.options.find((option) => serviceKey(option.service).includes(serviceKey(name)));
    return match && Number.isSafeInteger(match.feeCents) && match.feeCents >= 0
      ? match.feeCents : null;
  });
  if (fees.some((fee) => fee === null)) return null;
  // Price for the more expensive confirmed option so the customer quote still
  // works if either approved courier is used when the order is dispatched.
  return Math.max(...fees);
}

async function verifyRoundTrip(client, { customer, partner, pickupReadyAt, loadingBufferMinutes=10, acceptArrival }) {
  const [pickup, returned] = await Promise.all([
    client.quote({ from: customer, to: partner, ...(pickupReadyAt?{pickupReadyAt}:{}) }),
    client.quote({ from: partner, to: customer }),
  ]);
  const pickupCents = requiredFee(pickup);
  const returnCents = requiredFee(returned);
  if (pickupCents === null || returnCents === null) return null;
  let arrivals;
  if(pickupReadyAt) {
    const usable=pickup.options.filter(r=>/uber|doordash/i.test(r.service||'')&&Date.parse(r.pickupTime)>=Date.parse(pickupReadyAt)&&
      Date.parse(r.pickupTime)<=Date.parse(pickupReadyAt)+30*60000&&Date.parse(r.deliveryTime)>Date.parse(r.pickupTime)&&
      (!acceptArrival||acceptArrival(r.deliveryTime)));
    const inHouse=require('./pickup-timing').inHouseArrival(pickup,pickupReadyAt,loadingBufferMinutes);
    if(!usable.length||!inHouse||(acceptArrival&&!acceptArrival(inHouse)))return null;
    arrivals=[...usable.map(r=>r.deliveryTime),inHouse];
  }
  const expiries = [pickup.expiresAt, returned.expiresAt]
    .map(Date.parse).filter(Number.isFinite);
  if (expiries.length !== 2) throw Error('Shipday did not return fresh courier estimates.');
  return {
    pickupCents,
    returnCents,
    source: 'SHIPDAY',
    expiresAt: new Date(Math.min(...expiries)).toISOString(),
    ...(arrivals?{arrivalChecks:arrivals}:{}),
  };
}

module.exports = { REQUIRED_SERVICES, serviceKey, requiredFee, verifyRoundTrip };
