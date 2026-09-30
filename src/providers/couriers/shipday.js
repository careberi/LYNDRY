'use strict';

// Shipday's on-demand API quotes without creating an order. Keep creation and
// assignment separate: a failed/ambiguous write must be reconciled, never retried
// as a new booking. The caller must durably save the order ID before assignment.
const BASE = 'https://api.shipday.com';
const {contactFields} = require('./shipday-contact');

function cents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const result = Math.round(value * 100);
  return Number.isSafeInteger(result) ? result : null;
}

function address(value) {
  const result = typeof value === 'string' ? value.trim() : value &&
    [value.line1, value.line2, value.city, value.state, value.postalCode].filter(Boolean).join(', ');
  if (!result) throw new Error('Both courier addresses are required.');
  return result;
}

function identifier(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error('A valid Shipday order ID is required.');
  }
  return String(value);
}

function instant(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error('A valid delivery time is required.');
  return date.toISOString();
}

function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}

function estimates(body) {
  const rows = Array.isArray(body) ? body : [body];
  return rows.filter((row) => row && row.error === false && row.id != null &&
    String(row.id).trim() && typeof row.name === 'string' && row.name.trim() &&
    cents(row.fee) !== null).map((row) => ({
    reference: String(row.id), service: row.name, feeCents: cents(row.fee),
    // Shipday exposes these separately without documenting whether fee includes
    // them. Do not promise an all-in price when that contract is ambiguous.
    requiresFeeReview: Boolean(row.regulatoryFee || row.minBillableFee),
    pickupTime: row.pickupTime || null, deliveryTime: row.deliveryTime || null,
  })).sort((a, b) => a.feeCents - b.feeCents || a.service.localeCompare(b.service));
}

function delivery(body, expectedId) {
  if (!body || identifier(body.orderId) !== identifier(expectedId)) {
    throw new Error('Shipday returned a different delivery.');
  }
  // Keep unfamiliar states visible. Never infer collection from assignment.
  const states = { PICKEDUP: 'pickup_complete', ALREADY_DELIVERED: 'delivered',
    DELIVERED: 'delivered', CANCELLED: 'canceled', CANCELED: 'canceled' };
  return {
    id: String(body.orderId), provider: 'shipday',
    status: states[body.status] || body.status || 'unknown',
    providerStatus: body.status || null,
    service: body.thirdPartyName || null,
    feeCents: cents(body.totalBillableAmount),
    trackingUrl: safeUrl(body.trackingUrl),
    courier: body.driverName ? { name: body.driverName, phone: body.driverPhone || null,
      vehicle: body.driverVehicleDescription || null } : null,
    pin: null, pickupPhotoUrl: null, dropoffPhotoUrl: null,
  };
}

function createClient({ apiKey, fetchImpl = globalThis.fetch, allowWrites = false, allowEdits = false,
  now = Date.now, timeoutMs = 15000 } = {}) {
  async function request(method, path, body, mutation = false) {
    if (!apiKey || /[^\x21-\x7e]/.test(apiKey)) throw new Error('A valid Shipday API key is required.');
    if (mutation && !(mutation === 'edit' ? allowEdits : allowWrites)) throw new Error('Shipday live dispatch is disabled.');
    let response;
    try {
      response = await fetchImpl(BASE + path, { method, redirect: 'error',
        headers: { Authorization: `Basic ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      const error = new Error(mutation ? 'Shipday response unavailable. Reconcile the delivery before retrying.' : 'Shipday is unavailable.');
      error.uncertain = mutation;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Shipday request failed (HTTP ${response.status}).`);
      error.uncertain = mutation && response.status >= 500;
      throw error;
    }
    if (response.status === 204) return { success: true };
    try { return await response.json(); }
    catch {
      const error = new Error('Shipday returned an unreadable response.');
      error.uncertain = mutation;
      throw error;
    }
  }

  return {
    name: 'shipday', configured: Boolean(apiKey),
    services: () => request('GET', '/on-demand/services'),
    async drivers() {
      const rows = await request('GET', '/carriers');
      if (!Array.isArray(rows)) throw new Error('Shipday driver list unavailable.');
      return rows.map(d => ({id: identifier(d.id),name: String(d.name || ''),isActive: d.isActive === true,isOnShift: d.isOnShift === true}));
    },
    async assignDriver(orderId, driverId) {
      const rows = await this.drivers();
      const driver = rows.find(d => d.id === identifier(driverId) && d.isActive && d.isOnShift);
      if (!driver) return {ok:false,reason:'Driver is offline or inactive.'};
      const result = await request('PUT', '/orders/assign/' + identifier(orderId) + '/' + identifier(driverId), undefined, true);
      return result?.success === true ? {ok:true,courier:{name:driver.name}} : {ok:false,reason:'Driver assignment unconfirmed.'};
    },
    async unassign(orderId) {
      const result = await request('PUT', '/orders/unassign/' + identifier(orderId), undefined, true);
      return {ok:result?.success === true};
    },
    async quote({ from, to, pickupReadyAt, dropoffReadyAt }) {
      const options = estimates(await request('POST', '/on-demand/availability', {
        pickupAddress: address(from), deliveryAddress: address(to),
        ...(pickupReadyAt ? { pickUpTime: instant(pickupReadyAt) } : {}),
        ...(dropoffReadyAt ? { deliveryTime: instant(dropoffReadyAt) } : {}),
      })).filter((row) => !row.requiresFeeReview);
      if (!options.length) return { ok: false, reason: 'no_confirmed_price' };
      const selected = options[0];
      return { ok: true, quoteId: selected.reference, service: selected.service,
        feeCents: selected.feeCents, options,
        costCompleteness: 'courier_estimate_only',
        // Local freshness policy, not a provider guarantee. Assignment re-quotes.
        expiresAt: new Date(now() + 5 * 60 * 1000).toISOString(),
        expirySource: 'LYNDRY', provider: 'shipday' };
    },
    async createOrder({ externalId, from, to, pickupReadyAt, dropoffDeadlineAt, manifest = [] }) {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(externalId || '')) throw new Error('A stable order reference is required.');
      for (const endpoint of [from, to]) {
        if (!endpoint || !endpoint.name || !/^\+[1-9]\d{7,14}$/.test(endpoint.phone || '')) {
          throw new Error('Courier contacts need a name and international phone number.');
        }
      }
      const pickup = instant(pickupReadyAt), dropoff = instant(dropoffDeadlineAt);
      if (dropoff <= pickup) throw new Error('Delivery must follow pickup.');
      const result = await request('POST', '/orders', contactFields({
        orderNumber: externalId, restaurantName: from.name, restaurantAddress: address(from),
        restaurantPhoneNumber: from.phone, customerName: to.name, customerAddress: address(to),
        customerPhoneNumber: to.phone, expectedDeliveryDate: dropoff.slice(0, 10),
        expectedPickupTime: pickup.slice(11, 19), expectedDeliveryTime: dropoff.slice(11, 19),
        pickupInstruction: from.notes || '', deliveryInstruction: to.notes || '',
        orderSource: 'LYNDRY', orderItem: manifest.map((item) => ({ name: item.name,
          quantity: item.quantity, unitPrice: 0 })),
      }), true);
      if (!result || result.success !== true || !result.orderId) {
        const error = new Error('Shipday order creation was not confirmed. Reconcile before retrying.');
        error.uncertain = true;
        throw error;
      }
      return { id: identifier(result.orderId), provider: 'shipday', status: 'unassigned' };
    },
    async editOrder(orderId, body) {
      identifier(orderId);
      if (String(body?.orderId) !== String(orderId) || !body.orderNo) throw new Error('A matching existing order is required.');
      const result = await request('PUT', '/order/edit/' + orderId, contactFields(body), 'edit');
      if (result?.success !== true) { const error = new Error('Shipday delivery update was not confirmed. Reconcile before retrying.'); error.uncertain = true; throw error; }
      return {ok:true};
    },
    findOrders: (externalId) => {
      if (!externalId) throw new Error('An order reference is required.');
      return request('GET', `/orders/${encodeURIComponent(externalId)}`);
    },
    async assign(orderId, { maxFeeCents, requirePin = false, leaveAtDoor = false, pickupReadyAt = null, trip = null, acceptEstimate = null, beforeAssign = null } = {}) {
      identifier(orderId);
      if (!Number.isSafeInteger(maxFeeCents) || maxFeeCents < 0) throw new Error('An approved courier budget is required.');
      if (requirePin && leaveAtDoor) throw new Error('PIN delivery cannot be contactless.');
      // Order estimates can quote an immediate pickup despite the job's saved
      // schedule. Availability explicitly accepts the requested UTC pickup time.
      const options = pickupReadyAt && trip ? estimates(await request('POST','/on-demand/availability',{
        pickupAddress:address(trip.from),deliveryAddress:address(trip.to),pickUpTime:instant(pickupReadyAt),
      })) : estimates(await request('GET', `/on-demand/estimate/${orderId}`));
      const selected = options.find((row) => !row.requiresFeeReview && row.feeCents <= maxFeeCents &&
        (!pickupReadyAt || (['uber','doordash'].includes(row.service.toLowerCase()) &&
          Date.parse(row.pickupTime) >= Date.parse(pickupReadyAt) &&
          Date.parse(row.pickupTime) <= Date.parse(pickupReadyAt) + 30 * 60000 &&
          Date.parse(row.deliveryTime) > Date.parse(row.pickupTime))) &&
        (!acceptEstimate || acceptEstimate(row)));
      if (!selected) return { ok: false, quoteChanged: true, reason: 'courier_price_changed' };
      if (beforeAssign) await beforeAssign(selected);
      const result = await request('POST', '/on-demand/assign', {
        orderId: Number(orderId), name: selected.service, estimateReference: selected.reference,
        contactlessDelivery: leaveAtDoor, podType: requirePin ? 'PIN' : 'PHOTO',
      }, true);
      try { return { ok: true, ...delivery(result, orderId) }; }
      catch { const error = new Error('Shipday assignment was not confirmed. Reconcile before retrying.'); error.uncertain = true; throw error; }
    },
    async status(orderId) {
      return delivery(await request('GET', `/on-demand/details/${identifier(orderId)}`), orderId);
    },
    async cancel(orderId) {
      const result = await request('POST', `/on-demand/cancel/${identifier(orderId)}`, undefined, true);
      return result && result.success === true ? { ok: true, status: 'canceled' } : { ok: false, reason: 'cancellation_unconfirmed' };
    },
  };
}

module.exports = { createClient, cents, estimates, delivery };
