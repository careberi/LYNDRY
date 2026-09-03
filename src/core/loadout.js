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
//   2. THE ROUTE. Everything scanned becomes today's delivery run.
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
async function bagsInVan(order) {
  const orderId = typeof order === 'string' ? order : order.id;

  const delivery = await bags.forOrder(orderId, 'DELIVERY');
  if (delivery.length) return delivery;

  // THE FALLBACK MUST NOT SURVIVE A LAUNDROMAT VISIT.
  //
  // Falling back to the pickup labels is right for a bag that never left the
  // van - we washed it ourselves, so the bags at the door ARE the bags
  // collected. It is wrong the moment a laundromat has had it: they empty the
  // bags we brought and pack the clean laundry into their own, so those
  // stickers are in their bin.
  //
  // Left in, the delivery screen asked a driver to scan three stickers that no
  // longer physically exist, and he could not finish the stop. Neil found it on
  // a real order.
  //
  // partner_id is the signal, because it is set the moment the bags are handed
  // over. When it is set and no delivery labels exist, there is nothing to
  // scan and the count-and-weight check is what stands in its place.
  if (typeof order === 'object' && order && order.partner_id) return [];

  return bags.forOrder(orderId, 'PICKUP');
}

// --- The run itself ---------------------------------------------------------

// Everything currently in the van: loaded, not yet delivered.
// ---------------------------------------------------------------------------
// LOADING THE VAN, ONE BAG AT A TIME.
//
// NEIL'S SEQUENCE, and it is the mirror of the pickup at a customer's door:
//
//   scan it   ->   weigh it   ->   take the clip it gives you   ->   on the van
//
// and again for the next bag, until everything picked up off the laundromat's
// counter is aboard.
//
// WHY THE WEIGHING IS HERE AND NOT AT THE COUNTER. It used to be per ORDER,
// asked while he was still being handed bags - the wrong unit at the wrong
// moment, because he does not sort them into orders as they come across.
// Weighing at the van is per BAG, which is the thing he is actually holding,
// and it happens once rather than being interleaved with collecting.
//
// The clip comes from weighing, exactly as it does on the pickup leg: weigh,
// then clip. A clipped bag is a weighed bag, on both legs, for the same reason.
// ---------------------------------------------------------------------------

// Every bag off the laundromat that is not yet on the van, oldest first so the
// list does not shuffle under somebody working down it.
async function toLoad() {
  const { data, error } = await db
    .from('bag_labels')
    .select('*, orders(id, order_number, driver_id, status)')
    .eq('leg', 'DELIVERY')
    .not('collected_at', 'is', null)
    .is('loaded_at', null)
    .order('code', { ascending: true })
    .order('sticker_seq', { ascending: true });

  if (error) throw error;
  return data || [];
}

// WHAT THE DRIVER IS DOING RIGHT NOW, derived from the bag rather than stored.
//
//   no weight            weigh it
//   weight, no clip      the clip could not be issued - say so
//   weight and a clip    put the clip on and confirm it is aboard
//
// Same rule as the guided run: the state is read off the row, so a driver who
// refreshes, switches phones or comes back an hour later is in the same place.
function loadStateOf(label, picked = true) {
  // NOT PICKED YET. The scan is how he says which bag is in his hand - it is a
  // confirmation, not a search, because the screen already knows which bags are
  // outstanding. Doing it this way means no "has he scanned it" flag to store:
  // the answer is whether a bag has been chosen on this screen, and a refresh
  // simply asks again, which is the safe direction.
  if (!picked) return 'SCAN';

  if (label.weight_lb == null) return 'WEIGH';
  if (label.clip_number == null) return 'NO_CLIP';
  return 'ON_VAN';
}

// Record a bag's weight at the van and issue its clip in one step.
//
// One step because they are one action: the clip is what the weighing earns,
// and a screen that asked him to weigh and then separately fetch a number would
// be two taps for one thing he does with one hand.
async function weighAndClip(labelId, weightLb) {
  const weight = Number(weightLb);

  if (!Number.isFinite(weight) || weight <= 0 || weight > 200) {
    return { ok: false, detail: 'That weight does not look right. Pounds, as a number.' };
  }

  const { data: label, error: findError } = await db
    .from('bag_labels')
    .select('*, orders(driver_id)')
    .eq('id', labelId)
    .maybeSingle();

  if (findError) throw findError;
  if (!label) return { ok: false, detail: 'No bag with that id.' };
  if (!label.collected_at) {
    return { ok: false, detail: 'That bag has not been collected from the laundromat yet.' };
  }

  const { error } = await db
    .from('bag_labels')
    .update({ weight_lb: weight, weighed_at: new Date().toISOString() })
    .eq('id', labelId);

  if (error) throw error;

  // A FRESH CLIP, not the one it went out under. That number was freed the
  // moment the bag was handed to the laundromat and something else is probably
  // wearing it by now.
  const clipped = await bags.assignClip(
    { ...label, clip_number: null },
    (label.orders || {}).driver_id
  );

  return {
    ok: true,
    weight,
    clip: clipped.ok ? clipped.clip : null,
    ranOut: clipped.ok ? null : clipped.detail,
  };
}

// "It is on the van." The last step for one bag.
async function markLoaded(labelId) {
  const { data: label, error: findError } = await db
    .from('bag_labels')
    .select('id, order_id, weight_lb, collected_at, loaded_at')
    .eq('id', labelId)
    .maybeSingle();

  if (findError) throw findError;
  if (!label) return { ok: false, detail: 'No bag with that id.' };

  // NOTHING GOES ABOARD UNWEIGHED, which is the same rule the pickup leg has at
  // the customer's door: the van is the last place it could be weighed and by
  // then it is too late.
  if (label.weight_lb == null) {
    return { ok: false, detail: 'Weigh it before it goes in the van.' };
  }

  const now = new Date().toISOString();

  const { error } = await db.from('bag_labels').update({ loaded_at: now }).eq('id', labelId);
  if (error) throw error;

  // The ORDER's loaded_at is set by the first of its bags: it answers "did any
  // of this leave the laundromat", which is true as soon as one did.
  await db
    .from('orders')
    .update({ loaded_at: now })
    .eq('id', label.order_id)
    .is('loaded_at', null);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// RECONCILING THE LOAD, once every bag is aboard.
//
// NEIL'S TWO CHECKS, and they answer different questions:
//
//   THE COUNT   is everything we took off their counter now in the van?
//               Cheap, and it is the one that catches a bag set down and
//               forgotten between the shelf and the tailgate.
//
//   THE WEIGHT  for each order, does the total of its bags agree with the two
//               other scales that have touched this laundry - the laundromat's
//               figure, and what the driver collected from the customer?
//
// WHY IT HAPPENS HERE AND NOT AT THE COUNTER. This is the first moment every
// bag has a weight: they are weighed one at a time as they go in, so no total
// exists until the last one is aboard. Asking earlier would be asking a
// question nothing could answer.
//
// TWO COMPARISONS, AND THEY ARE NOT THE SAME SHAPE.
//
//   against the laundromat  two scales, same clean laundry. Symmetric - a gap
//                           either way just means a scale is off - and it goes
//                           through the admin's three bands.
//
//   against the customer    DIRTY in against CLEAN out. Asymmetric on purpose:
//                           water and grit come out in the wash, so lighter is
//                           normal and heavier means somebody else's clothes
//                           are in the pile. tags.checkHandover() owns that.
//
// It writes the summed weight onto the order and reports; it raises nothing and
// blocks nothing by itself. The caller decides what a failure means, because
// "hold the van" and "tell somebody in the morning" are different answers and
// this is not the place to choose between them.
// ---------------------------------------------------------------------------

async function reconcileLoad(driverId = null) {
  const partners = require('./partners');
  const settings = require('./settings');
  const tags = require('./tags');

  // Everything collected off a laundromat that is now aboard, with its order.
  let query = db
    .from('bag_labels')
    .select('*, orders(id, order_number, driver_id, weight_lb, partner_weight_lb, return_bag_count, return_weight_lb)')
    .eq('leg', 'DELIVERY')
    .not('collected_at', 'is', null);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).filter((b) => b.orders && (!driverId || b.orders.driver_id === driverId));

  const byOrder = new Map();
  for (const row of rows) {
    if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, { order: row.orders, bags: [] });
    byOrder.get(row.order_id).bags.push(row);
  }

  const limits = await settings.weightLimits();
  const results = [];

  for (const [orderId, { order, bags: mine }] of byOrder) {
    const aboard = mine.filter((b) => b.loaded_at);
    const weighed = aboard.filter((b) => b.weight_lb != null);

    // THE COUNT. Everything picked up should be in the van.
    const count = {
      collected: mine.length,
      aboard: aboard.length,
      ok: aboard.length === mine.length,
      missing: mine.filter((b) => !b.loaded_at).map((b) => `${b.code}-${b.sticker_seq}`),
    };

    // A HALF-WEIGHED ORDER IS NOT COMPARED AGAINST A WHOLE ONE. Summing what
    // has been weighed so far and calling it the total would flag every order
    // mid-load as light - the same trap the partner's per-bag weights had.
    if (!count.ok || weighed.length !== aboard.length || !aboard.length) {
      results.push({ order, count, weight: null, pending: true });
      continue;
    }

    const total = require('./weight').sum(weighed.map((b) => b.weight_lb));

    const vsPartner =
      order.partner_weight_lb == null
        ? null
        : partners.compareWeights(
            { weight_lb: total, partner_weight_lb: Number(order.partner_weight_lb) },
            limits
          );

    // Dirty in against clean out. Never Math.abs - lighter and heavier mean
    // opposite things here.
    const vsCustomer =
      order.weight_lb == null
        ? null
        : tags.checkHandover({ wentIn: Number(order.weight_lb), cameBack: total }, limits);

    results.push({
      order,
      count,
      weight: { total, vsPartner, vsCustomer },
      pending: false,
    });
  }

  return { results, limits };
}

// Write the summed van weight onto each order, once its bags are all aboard and
// weighed. Separate from the comparing so a screen can show the reconciliation
// without committing to it, and so a failed write cannot lose the reading.
async function recordLoadedWeights(results) {
  for (const r of results) {
    if (r.pending || !r.weight) continue;

    await db
      .from('orders')
      .update({ return_weight_lb: r.weight.total.toFixed(2) })
      .eq('id', r.order.id);
  }
}

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
    order.bags = await bagsInVan(order);
  }

  return orders;
}

// Work out the order of the route and write a stop number onto each order.
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
// right only while a bag made the route trip. It does not: the laundromat
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
async function allBagsScanned(orderIdOrOrder) {
  const labels = await bagsInVan(orderIdOrOrder);

  if (!labels.length) return { ok: true, total: 0, scanned: 0 };

  const scanned = labels.filter((l) => l.delivered_at).length;

  return { ok: scanned === labels.length, total: labels.length, scanned, labels };
}

module.exports = {
  toLoad,
  reconcileLoad,
  recordLoadedWeights,
  loadStateOf,
  weighAndClip,
  markLoaded,
  LOADABLE,
  bagsInVan,
  scanIn,
  scanOut,
  currentRun,
  buildRun,
  scanAtDoor,
  allBagsScanned,
};
