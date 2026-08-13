'use strict';

const db = require('../db');
const bags = require('./bags');
const geocode = require('./geocode');

// ---------------------------------------------------------------------------
// The load-out pass.
//
// The driver stands at the laundromat and scans every bag as he puts it in the
// van. One continuous pass, not a search - he is touching each bag anyway.
// Three things come out of it:
//
//   1. CHAIN OF CUSTODY. A scan is the proof the bag left the partner with us.
//   2. THE ROUND. Everything scanned becomes today's delivery run.
//   3. A STOP NUMBER PER BAG, which he writes on a reusable tag and clips on.
//
// Then he loads in REVERSE - stop 12 deepest, stop 1 by the door - so every
// bag is at the tailgate when he arrives. That is the whole trick. Numbered
// tags without reverse loading just means climbing over stop 9 to reach stop 2.
//
// At the door he scans again TO CONFIRM, NOT TO FIND. He already has the bag
// marked 4 in his hand; the scan says yes or WRONG BAG. That is the net that
// catches a mis-clipped tag before it becomes two customers holding each
// other's laundry.
// ---------------------------------------------------------------------------

// Statuses a bag can legitimately be scanned out of. READY is the normal one -
// the partner has finished it. IN_PROCESS covers a bag we washed ourselves,
// which never went to a partner at all.
const LOADABLE = ['IN_PROCESS', 'AT_PARTNER', 'READY'];

const RUN_FIELDS =
  'id, order_number, status, stop_number, loaded_at, weight_lb, ' +
  'customers(id, name, phone, address_line1, address_line2, city, state, postal_code, lat, lng, geocode_failed, preferences)';

// --- Scanning a bag into the van --------------------------------------------

async function scanIn(rawCode, opsUserId) {
  const label = await bags.findByCode(rawCode);

  if (!label) {
    return { ok: false, reason: 'unknown', detail: 'No label with that code.' };
  }

  if (!label.order_id) {
    return {
      ok: false,
      reason: 'unbound',
      detail: `Label ${label.code} isn't on a bag. Stick it on at pickup first.`,
    };
  }

  const { data: order, error } = await db
    .from('orders')
    .select(RUN_FIELDS)
    .eq('id', label.order_id)
    .maybeSingle();

  if (error) throw error;
  if (!order) return { ok: false, reason: 'unknown', detail: 'That label points at nothing.' };

  if (!LOADABLE.includes(order.status)) {
    return {
      ok: false,
      reason: 'wrong_status',
      detail: `Order #${order.order_number} is ${order.status.replace(/_/g, ' ').toLowerCase()}, so it can't be loaded.`,
    };
  }

  // Scanning the same bag twice is a driver double-checking, not an error.
  if (label.loaded_at) {
    return { ok: true, already: true, label, order };
  }

  const now = new Date().toISOString();

  await db.from('bag_labels').update({ loaded_at: now }).eq('id', label.id);

  // A CLIP GOES ON THE CLEAN LEG TOO.
  //
  // The clip's life is the VAN, not the trip out. A clean bag going back to a
  // door needs a number on it for exactly the same reason a dirty one did:
  // "deliver order 1003, clips 4, 6, 7 and 10" is something a driver can act on
  // and a sticker code is not.
  //
  // A fresh number rather than the one it went out under - it was freed the
  // moment the bag was handed over, and by now something else is probably
  // wearing it.
  const clipped = await bags.assignClip({ ...label, clip_number: null }, order.driver_id);

  // The order's own loaded_at is set by the FIRST of its bags. It answers "did
  // this order leave the partner", which is true as soon as any of it did.
  if (!order.loaded_at) {
    await db.from('orders').update({ loaded_at: now }).eq('id', order.id);
    order.loaded_at = now;
  }

  return { ok: true, label, order, clip: clipped.ok ? clipped.clip : null, clipProblem: clipped.ok ? null : clipped.detail };
}

// Take a bag back out, for when the wrong one was scanned.
async function scanOut(labelId) {
  const { data: label } = await db
    .from('bag_labels')
    // The clip comes off with it - a bag that is not in the van is not wearing
    // one of the van's numbers.
    .update({ loaded_at: null, unclipped_at: new Date().toISOString() })
    .eq('id', labelId)
    .select('*')
    .maybeSingle();

  if (!label || !label.order_id) return label || null;

  // If that was the last bag of the order, the order is no longer loaded and
  // drops out of the run rather than sitting there as an empty stop.
  const siblings = await bagsInVan(label.order_id);
  if (!siblings.some((b) => b.loaded_at)) {
    await db.from('orders').update({ loaded_at: null, stop_number: null }).eq('id', label.order_id);
  }

  return label;
}

// The bags physically in the van for this order.
//
// After a laundromat leg that is the DELIVERY labels - its own bags, its own
// count. Before one, or when we washed it ourselves, it is the pickup labels,
// because those bags never left the van. One helper so the fallback is written
// once and the three callers cannot disagree about it.
async function bagsInVan(orderId) {
  const delivery = await bags.forOrder(orderId, 'DELIVERY');
  return delivery.length ? delivery : bags.forOrder(orderId, 'PICKUP');
}

// --- The run itself ---------------------------------------------------------

// Everything currently in the van: loaded, not yet delivered.
async function currentRun() {
  const { data, error } = await db
    .from('orders')
    .select(RUN_FIELDS)
    .not('loaded_at', 'is', null)
    .in('status', LOADABLE.concat('OUT_FOR_DELIVERY'))
    .order('stop_number', { ascending: true, nullsFirst: false });

  if (error) throw error;

  const orders = data || [];

  // The bags on each, so the screen can say "3 bags" and the door can count.
  for (const order of orders) {
    order.bags = await bagsInVan(order.id);
  }

  return orders;
}

// Work out the order of the round and write a stop number onto each order.
//
// Called when the driver taps "Build the run", not on every scan: geocoding is
// rate-limited to one address a second, and doing it per scan would make him
// wait a second between bags for no reason.
async function buildRun() {
  const orders = await currentRun();
  if (!orders.length) return { ok: true, orders: [], miles: 0 };

  // Look up anything we do not already have. Cached forever after the first
  // time, so this is only slow for genuinely new addresses.
  const points = [];
  for (const order of orders) {
    const customer = order.customers || {};
    const at = await geocode.locate(customer);
    points.push({ order, at });
  }

  const { ordered, miles } = geocode.sequence(points, geocode.BASE);

  // Written one at a time. There are a dozen of these, not a thousand, and a
  // loop that is obviously correct beats a clever bulk update here.
  for (let i = 0; i < ordered.length; i += 1) {
    const { order } = ordered[i];
    const stop = i + 1;
    if (order.stop_number === stop) continue;
    await db.from('orders').update({ stop_number: stop }).eq('id', order.id);
    order.stop_number = stop;
  }

  return {
    ok: true,
    miles,
    orders: ordered.map(({ order, at }) => ({ ...order, located: Boolean(at) })),
  };
}

// --- At the door ------------------------------------------------------------

// Scan a bag standing at a customer's door.
//
// This is a CONFIRMATION. The driver already has a bag in his hand, chosen by
// the number on its tag; all this does is agree or refuse. A refusal here is
// the cheap failure - the expensive one is two doors away, when the bag has
// been left and somebody else's laundry is gone.
async function scanAtDoor(rawCode, order) {
  const label = await bags.findByCode(rawCode);

  if (!label) return { ok: false, reason: 'unknown', detail: 'No label with that code.' };

  if (label.order_id !== order.id) {
    // Deliberately does NOT say whose bag it is. The driver does not need to
    // know, and the screen for one customer should not name another.
    return {
      ok: false,
      reason: 'wrong_bag',
      detail: `WRONG BAG. Label ${label.code} belongs to a different order. Check the tag.`,
    };
  }

  if (label.delivered_at) return { ok: true, already: true, label };

  await db
    .from('bag_labels')
    .update({ delivered_at: new Date().toISOString() })
    .eq('id', label.id);

  return { ok: true, label };
}

// Has every bag on this order been scanned at the door?
//
// An order with no labels at all passes: labelling is new, and refusing to
// deliver a bag that was picked up before stickers existed would strand it.
// Is every bag that is actually going to this door in the driver's hands?
//
// DELIVERY LABELS ONLY. This asked about every label on the order, which was
// right only while a bag made the round trip. It does not: the laundromat
// washes the contents and repacks into its own bags, so a three-bag collection
// can come back as one. Counting the pickup labels here left two stickers that
// could never be scanned - the camera never appeared and the order could not be
// delivered at all.
//
// An order with no delivery labels falls back to the pickup ones. That is for
// orders already in flight when this shipped, and for the day we wash something
// ourselves and it never goes to a laundromat - in both cases the bags at the
// door ARE the bags collected. An order with no labels at all still passes,
// because labelling is newer than the oldest orders.
async function allBagsScanned(orderId) {
  const labels = await bagsInVan(orderId);

  if (!labels.length) return { ok: true, total: 0, scanned: 0 };

  const scanned = labels.filter((l) => l.delivered_at).length;

  return { ok: scanned === labels.length, total: labels.length, scanned, labels };
}

module.exports = {
  LOADABLE,
  bagsInVan,
  scanIn,
  scanOut,
  currentRun,
  buildRun,
  scanAtDoor,
  allBagsScanned,
};
