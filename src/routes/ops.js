'use strict';

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const db = require('../db');
const orders = require('../core/orders');
const { sendAndLog } = require('../core/notify');
const { config } = require('../config');
const { site } = require('../web/site');
const { readableDate } = require('../core/actions');

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

function requireAdminKey(req, res, next) {
  const provided = req.get('x-admin-key') || '';
  const expected = config.adminApiKey;

  if (!expected) {
    console.error('ADMIN_API_KEY is not set — ops endpoints are refusing everything.');
    return res.status(503).json({ error: 'ops_not_configured' });
  }

  // Compare in constant time. A plain === leaks how much of the key was
  // correct through how long the comparison took, which is enough to guess a
  // secret one character at a time.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    console.warn('Rejected an ops request with a bad admin key.');
    return res.status(401).json({ error: 'unauthorized' });
  }

  return next();
}

router.use('/ops', requireAdminKey);

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

    await sendAndLog(
      customer.phone,
      `Your laundry weighed ${weight} lb, so that's ${money(priceCents)} at ${site.pricePerLb} a pound. ` +
        `We'll have it back to you within ${site.turnaround}.`,
      customer.id
    );

    res.json({
      ok: true,
      order_id: order.id,
      weight_lb: updated.weight_lb,
      price_cents: updated.price_cents,
      price: money(updated.price_cents),
      over_max_order: over,
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

    let photoUrl = null;

    if (req.file) {
      const extension = (req.file.mimetype.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const path = `${order.id}/${Date.now()}.${extension}`;

      const { error: uploadError } = await db.storage
        .from(PHOTO_BUCKET)
        .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

      if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);

      const { data: signed, error: signError } = await db.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(path, PHOTO_LINK_DAYS * 24 * 60 * 60);

      if (signError) throw new Error(`Could not create photo link: ${signError.message}`);
      photoUrl = signed.signedUrl;
    }

    let updated;
    try {
      updated = await orders.transition(order, 'DELIVERED');
    } catch (err) {
      return handleTransitionError(err, res);
    }

    if (photoUrl) {
      await db.from('orders').update({ delivery_photo_url: photoUrl }).eq('id', order.id);
    }

    const customer = order.customers;
    const price = order.price_cents ? ` ${money(order.price_cents)} for this one.` : '';
    const photo = photoUrl ? ` Photo: ${photoUrl}` : '';

    await sendAndLog(
      customer.phone,
      `Delivered — your laundry is at your door.${price}${photo}`,
      customer.id
    );

    res.json({ ok: true, order_id: order.id, status: updated.status, photo: Boolean(photoUrl) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /ops/today — the driver's run sheet
// ---------------------------------------------------------------------------

router.get('/ops/today', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await db
      .from('orders')
      .select('*, customers(name, phone, address_line1, address_line2, city, state, postal_code, preferences)')
      .in('status', orders.IN_FLIGHT)
      .order('pickup_date', { ascending: true });

    if (error) throw error;

    const describe = (o) => {
      const c = o.customers || {};
      const address = [c.address_line1, c.address_line2, c.city && `${c.city} ${c.postal_code}`]
        .filter(Boolean)
        .join(', ');

      return {
        order_id: o.id,
        name: c.name,
        phone: c.phone,
        address,
        pickup_date: o.pickup_date,
        pickup_method: o.pickup_method,
        bag_count: o.bag_count,
        weight_lb: o.weight_lb,
        price: o.price_cents ? money(o.price_cents) : null,
        notes: o.notes || null,
        // The driver needs the standing instructions too — a gate code the
        // customer gave once at signup is no use sitting in the database.
        standing_instructions: (c.preferences || {}).special_instructions || null,
        status: o.status,
      };
    };

    const all = (data || []).map(describe);

    res.json({
      date: today,
      // Anything due today or overdue — an order left from yesterday should
      // not silently drop off the run sheet.
      pickups: all.filter((o) => orders.AWAITING_COLLECTION.includes(o.status) && o.pickup_date <= today),
      upcoming_pickups: all.filter((o) => orders.AWAITING_COLLECTION.includes(o.status) && o.pickup_date > today),
      awaiting_weight: all.filter((o) => o.status === 'IN_PROCESS' && !o.weight_lb),
      washing: all.filter((o) => o.status === 'IN_PROCESS' && o.weight_lb),
      out_for_delivery: all.filter((o) => o.status === 'OUT_FOR_DELIVERY'),
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
