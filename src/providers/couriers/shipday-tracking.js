'use strict';

// The public tracking feed is supplemental display data, never receipt evidence.
// Keep its host fixed and do not forward the API credential or its customer data.
function tokenFromUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['www.ordertracking.io','ordertracking.io'].includes(u.hostname) || u.port || u.username || u.password) return null;
    const path = u.pathname;
    const match = path.match(/^\/d\/[a-z]{2}\/[\w-]+\/([A-Za-z0-9_=+-]{4,256})$/) || path.match(/^\/[\w-]+\/delivery\/([A-Za-z0-9_=+-]{4,256})(?:&lang=[a-z]{2})?$/);
    return match ? match[1] : null;
  } catch { return null; }
}
function phone(value) {
  const s = String(value || '').replace(/[ ()-]/g,'');
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
function minutes(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1440 ? Math.ceil(n) : null;
}
function createTracking({fetchImpl = globalThis.fetch, timeoutMs = 5000} = {}) {
  return async function trackingInfo(url, expected) {
    const token = tokenFromUrl(url);
    if (!token) return null;
    try {
      const response = await fetchImpl('https://report.shipday.com/eta/order/progress/' + token + '?isStaticDataRequired=true', {
        method:'GET', redirect:'error', headers:{Accept:'application/json'}, signal:AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > 1000000) return null;
      const body = JSON.parse(text), fixed = body.fixedData, live = body.dynamicData;
      if (!fixed || fixed.isExpired || fixed.order?.orderNumber !== expected.reference || (live?.order?.status ?? live?.orderStatus?.status) !== expected.status) return null;
      // A phone fallback must belong to the same assigned carrier, never customer/restaurant contacts.
      const sameDriver = expected.driverId != null && String(fixed.carrier?.id) === String(expected.driverId);
      return {etaMinutes:minutes(live.estimatedTimeInMinutes),driverPhone:sameDriver ? phone(fixed.carrier.phoneNumber) : null,
        pickupEtaMinutes:sameDriver && ['NOT_ACCEPTED','NOT_STARTED_YET','STARTED'].includes(expected.status) ? minutes(live.detailEta?.pickUpTime) : null};
    } catch { return null; }
  };
}
module.exports = {createTracking,tokenFromUrl,phone,minutes};
