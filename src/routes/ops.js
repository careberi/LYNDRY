'use strict';

const express = require('express');
const multer = require('multer');

const db = require('../db');
const orders = require('../core/orders');
const billing = require('../core/billing');
const auth = require('../core/admin-auth');
const { sendAndLog } = require('../core/notify');
const { config } = require('../config');
const { site } = require('../web/site');
const { readableDate } = require('../core/actions');
const booking = require('../core/booking');

const router = express.Router();

// Photos are held in memory and pushed straight to storage — nothing is
// written to the server's disk, which has no persistent storage anyway.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const PHOTO_BUCKET = 'delivery-photos';

// How long a delivery photo link stays alive. Matches the privacy policy's
// promise that photos are kept for a limited period.
const PHOTO_LINK_DAYS = 30;

// ---------------------------------------------------------------------------
// Who is allowed in
//
// One shared secret in a header. No login system, no accounts — the only
// people using these endpoints are Neil and his driver.
// ---------------------------------------------------------------------------

// The check itself lives in src/core/admin-auth.js so the JSON API and the
// browser screens can't drift apart. It accepts either the x-admin-key header
// (scripts, the driver simulator) or the signed cookie the sign-in page sets,
// which is what lets a button on an ops screen call these endpoints.
router.use('/ops', auth.requireAdminApi);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Loads an order plus the customer it belongs to, or sends the error itself.
async function loadOrder(req, res) {
  const orderId = req.body.order_id || req.query.order_id;

  if (!orderId) {
    res.status(400).json({ error: 'order_id_required' });
    return null;
  }

  const { data, error } = await db
    .from('orders')
    .select('*, customers(*)')
    .eq('id', orderId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    res.status(404).json({ error: 'order_not_found' });
    return null;
  }

  return data;
}

// Turns a state machine refusal into a 409 the driver can understand, rather
// than a 500 that looks like the server broke.
function handleTransitionError(err, res) {
  if (/cannot go from/i.test(err.message)) {
    return res.status(409).json({ error: 'illegal_transition', detail: err.message });
  }
  throw err;
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// POST /ops/collected — the driver has the bag
//
// This is the moment the laundry becomes our responsibility, and the moment
// the customer loses the ability to cancel. Both follow from this one call.
// ---------------------------------------------------------------------------

router.post('/ops/collected', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;

    const bagCount = Number(req.body.bag_count) || order.bag_count || null;

    let updated;
    try {
      updated = await orders.transition(order, 'IN_PROCESS');
    } catch (err) {
      return handleTransitionError(err, res);
    }

    if (bagCount && bagCount !== order.bag_count) {
      await db.from('orders').update({ bag_count: bagCount }).eq('id', order.id);
      updated.bag_count = bagCount;
    }

    const customer = order.customers;
    await sendAndLog(
      customer.phone,
      `We've collected your laundry. It'll be washed, folded and back with you within ${site.turnaround}.`,
      customer.id
    );

    res.json({ ok: true, order_id: order.id, status: updated.status, bag_count: updated.bag_count });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /ops/weight — record the weight, which sets the price
//
// Wash and fold is charged by the pound, so this is where an order stops
// having an estimate and starts having a real number. The rate used is the one
// stored on the order, not today's rate — a price change must never re-price
// work that was already quoted.
// ---------------------------------------------------------------------------

router.post('/ops/weight', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;

    const weight = Number(req.body.weight_lb);

    if (!Number.isFinite(weight) || weight <= 0 || weight > 200) {
      return res.status(400).json({ error: 'weight_lb_invalid', detail: 'Expected a weight in pounds between 0 and 200.' });
    }

    if (!orders.IN_FLIGHT.includes(order.status)) {
      return res.status(409).json({ error: 'order_not_active', detail: `That order is ${order.status}.` });
    }

    const rate = order.price_per_lb_cents || config.pricing.perPoundCents;
    const priceCents = Math.round(weight * rate);

    // Weight and price are written together — the database refuses one
    // without the other, so an order can never carry a charge that no weight
    // justifies.
    const { data: updated, error } = await db
      .from('orders')
      .update({ weight_lb: weight, price_cents: priceCents })
      .eq('id', order.id)
      .select('*')
      .single();

    if (error) throw error;

    const customer = order.customers;
    const over = weight > config.pricing.maxOrderLb;

    // Weighing is the moment the card gets charged. The customer already
    // authorised it — once when they saved the card, and again when they
    // confirmed this order by text — so there is nothing more to ask them.
    //
    // The message is written by the billing layer, because it is the only
    // thing that knows whether the charge went through, and the customer must
    // not be told "charged" if it didn't.
    const charge = await billing.chargeOrder(updated, customer);

    if (charge.message) {
      await sendAndLog(customer.phone, charge.message, customer.id);
    } else {
      // Nothing to charge — already paid, or waived by Neil. Still tell them
      // the weight, because that is the number they were promised.
      await sendAndLog(
        customer.phone,
        `Your laundry weighed ${weight} lb, so that's ${money(priceCents)} at ${site.pricePerLb} a pound. ` +
          `We'll have it back to you within ${site.turnaround}.`,
        customer.id
      );
    }

    res.json({
      ok: true,
      order_id: order.id,
      weight_lb: updated.weight_lb,
      price_cents: updated.price_cents,
      price: money(updated.price_cents),
      over_max_order: over,
      // The driver's screen needs to show this. A declined card is not their
      // problem to solve, but "keep going, we'll chase it" is worth knowing.
      paid: Boolean(charge.ok),
      payment_note: charge.ok ? null : charge.needsCard ? 'no card on file' : 'card declined',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /ops/out-for-delivery
// ---------------------------------------------------------------------------

router.post('/ops/out-for-delivery', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;

    let updated;
    try {
      updated = await orders.transition(order, 'OUT_FOR_DELIVERY');
    } catch (err) {
      return handleTransitionError(err, res);
    }

    const customer = order.customers;
    const price = order.price_cents ? ` That's ${money(order.price_cents)}.` : '';

    await sendAndLog(
      customer.phone,
      `Your laundry is washed, folded and out for delivery today.${price}`,
      customer.id
    );

    res.json({ ok: true, order_id: order.id, status: updated.status });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /ops/delivered — with a photo
//
// The photo is the proof. It goes into a private bucket, and the customer gets
// a link that expires — a picture of somebody's front door is not something to
// leave publicly readable forever.
// ---------------------------------------------------------------------------

router.post('/ops/delivered', upload.single('photo'), async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;

    let photoPath = null;
    let photoUrl = null;

    if (req.file) {
      const extension = (req.file.mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      photoPath = `${order.id}/${Date.now()}.${extension}`;

      const { error: uploadError } = await db.storage
        .from(PHOTO_BUCKET)
        .upload(photoPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

      if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);

      // The customer gets a short link on our own domain, not a signed
      // storage URL. Carriers distrust links to domains that aren't yours,
      // and a signature with an expiry date in it would eventually break the
      // photo. We sign on demand instead, when someone opens the link.
      photoUrl = `${config.baseUrl}/p/${order.id}`;
    }

    let updated;
    try {
      updated = await orders.transition(order, 'DELIVERED');
    } catch (err) {
      return handleTransitionError(err, res);
    }

    if (photoUrl) {
      await db
        .from('orders')
        .update({ delivery_photo_url: photoUrl, delivery_photo_path: photoPath })
        .eq('id', order.id);
    }

    const customer = order.customers;
    const photo = photoUrl ? ` Photo: ${photoUrl}` : '';

    // What we say about the money depends on whether we actually got it. A
    // delivery text that reads like a receipt when the card was declined is
    // how an unpaid order quietly becomes a forgotten one.
    let price = '';
    if (order.price_cents && order.payment_status === 'PAID') {
      price = ` ${money(order.price_cents)}, paid.`;
    } else if (order.price_cents && order.payment_status === 'FAILED') {
      price = ` ${money(order.price_cents)} is still outstanding — the card link we sent will settle it.`;
    } else if (order.price_cents) {
      price = ` ${money(order.price_cents)} for this one.`;
    }

    await sendAndLog(
      customer.phone,
      `Delivered. Your laundry is at your door.${price}${photo}`,
      customer.id
    );

    res.json({
      ok: true,
      order_id: order.id,
      status: updated.status,
      photo: Boolean(photoUrl),
      payment_status: order.payment_status,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /ops/charge — try a declined card again
//
// For the case where a customer says "try it now, I've moved money across".
// Charging is otherwise automatic at /ops/weight; this is the manual lever.
// ---------------------------------------------------------------------------

router.post('/ops/charge', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;

    if (order.payment_status === 'PAID') {
      return res.status(409).json({ error: 'already_paid', paid_at: order.paid_at });
    }
    if (!order.price_cents) {
      return res.status(409).json({ error: 'not_weighed', detail: 'Record the weight first.' });
    }

    const customer = order.customers;
    const charge = await billing.chargeOrder(order, customer);

    if (charge.message) await sendAndLog(customer.phone, charge.message, customer.id);

    res.json({
      ok: Boolean(charge.ok),
      order_id: order.id,
      price: money(order.price_cents),
      detail: charge.ok ? 'charged' : charge.needsCard ? 'no card on file' : 'declined',
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /ops/waive — decide not to charge for an order
//
// A redo, a complaint, a goodwill gesture. Recorded as WAIVED rather than
// silently marked paid, so the books show the difference between money that
// arrived and money that was let go.
// ---------------------------------------------------------------------------

router.post('/ops/waive', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;

    if (order.payment_status === 'PAID') {
      return res.status(409).json({
        error: 'already_paid',
        detail: 'That one has been charged. A refund has to be issued in the payment dashboard.',
      });
    }

    const reason = String(req.body.reason || '').trim();

    const { error } = await db
      .from('orders')
      .update({
        payment_status: 'WAIVED',
        payment_failure_reason: reason ? `Waived: ${reason}`.slice(0, 500) : 'Waived.',
      })
      .eq('id', order.id);

    if (error) throw error;

    // Only tell the customer if there was a charge hanging over them. Someone
    // who never knew they owed anything doesn't need a message about it.
    if (order.payment_status === 'FAILED' && order.price_cents) {
      const customer = order.customers;
      await sendAndLog(
        customer.phone,
        `We've cleared the ${money(order.price_cents)} on your last order, nothing owing. Sorry for the trouble.`,
        customer.id
      );
    }

    res.json({ ok: true, order_id: order.id, payment_status: 'WAIVED' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/today — the driver's run sheet
// ---------------------------------------------------------------------------

router.get('/ops/today', async (req, res, next) => {
  try {
    // New Jersey's date, not the server's — see src/core/booking.js. A run
    // sheet that flips to tomorrow at 8pm is worse than useless to a driver
    // still finishing today's round.
    const today = booking.today();

    const { data, error } = await db
      .from('orders')
      .select('*, customers(name, phone, address_line1, address_line2, city, state, postal_code, preferences)')
      .in('status', orders.IN_FLIGHT)
      // Within a day, earliest requested time first, so the run sheet is in the
      // order the van should drive it. Orders with no time asked for sort last
      // — they are the ones with the most freedom to slot in anywhere.
      .order('pickup_date', { ascending: true })
      .order('pickup_time', { ascending: true, nullsFirst: false });

    if (error) throw error;

    // Orders where the money never arrived. Separate query because these are
    // usually DELIVERED — already off the in-flight list, still owed.
    const { data: unpaidRows, error: unpaidError } = await db
      .from('orders')
      .select('*, customers(name, phone, address_line1, address_line2, city, state, postal_code, preferences)')
      .eq('payment_status', 'FAILED')
      .order('pickup_date', { ascending: true });

    if (unpaidError) throw unpaidError;

    const describe = (o) => {
      const c = o.customers || {};
      const address = [c.address_line1, c.address_line2, c.city && `${c.city} ${c.postal_code}`]
        .filter(Boolean)
        .join(', ');

      return {
        order_id: o.id,
        // What the driver actually says out loud. The UUID is for the API.
        order_number: o.order_number,
        name: c.name,
        phone: c.phone,
        address,
        pickup_date: o.pickup_date,

        // Both forms on purpose: the raw time for anything that sorts or
        // filters, and the window the customer was actually promised, so the
        // driver is working to the same words the customer read.
        pickup_time: o.pickup_time ? booking.normaliseTime(o.pickup_time) : null,
        pickup_window: booking.arrivalWindow(o.pickup_time),

        pickup_method: o.pickup_method,
        bag_count: o.bag_count,
        weight_lb: o.weight_lb,
        price: o.price_cents ? money(o.price_cents) : null,
        notes: o.notes || null,
        payment_status: o.payment_status,
        // The driver needs the standing instructions too — a gate code the
        // customer gave once at signup is no use sitting in the database.
        standing_instructions: (c.preferences || {}).special_instructions || null,
        status: o.status,
      };
    };

    const all = (data || []).map(describe);
    const unpaid = unpaidRows || [];

    res.json({
      date: today,
      // Anything due today or overdue — an order left from yesterday should
      // not silently drop off the run sheet.
      pickups: all.filter((o) => orders.AWAITING_COLLECTION.includes(o.status) && o.pickup_date <= today),
      upcoming_pickups: all.filter((o) => orders.AWAITING_COLLECTION.includes(o.status) && o.pickup_date > today),
      awaiting_weight: all.filter((o) => o.status === 'IN_PROCESS' && !o.weight_lb),
      washing: all.filter((o) => o.status === 'IN_PROCESS' && o.weight_lb),
      out_for_delivery: all.filter((o) => o.status === 'OUT_FOR_DELIVERY'),
      // Money we're owed. Deliberately not filtered by date — an unpaid order
      // from last week is exactly the one worth seeing.
      unpaid: unpaid.map(describe),
    });
  } catch (err) {
    next(err);
  }
});

// A photo that's too big should say so, not look like the server fell over.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({
      error: tooBig ? 'photo_too_large' : 'bad_upload',
      detail: tooBig ? 'Photos must be under 10MB. Try again at a lower resolution.' : err.message,
    });
  }
  return next(err);
});

module.exports = { router };
