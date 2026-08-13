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
const fulfilment = require('../core/fulfilment');
const recurring = require('../core/recurring');

const router = express.Router();

// Photos are held in memory and pushed straight to storage — nothing is
// written to the server's disk, which has no persistent storage anyway.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

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

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// The steps of an order's day
//
// Thin wrappers. Every one of these calls src/core/fulfilment.js, which is the
// same code the buttons on the ops screens call. Two implementations of
// "collected" would have drifted the first time one of them learned something
// the other did not.
// ---------------------------------------------------------------------------

// Turns a fulfilment result into the right HTTP answer.
function send(res, result, extra = {}) {
  if (!result.ok) {
    const illegal = result.reason === 'illegal';
    return res
      .status(illegal ? 409 : 400)
      .json({ error: illegal ? 'illegal_transition' : 'invalid_request', detail: result.detail });
  }

  return res.json({
    ok: true,
    order_id: result.order.id,
    order_number: result.order.order_number,
    status: result.order.status,
    ...extra,
  });
}

router.post('/ops/collected', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;

    const result = await fulfilment.collect(order, { bagCount: req.body.bag_count });
    return send(res, result, result.ok ? { bag_count: result.order.bag_count } : {});
  } catch (err) {
    next(err);
  }
});

router.post('/ops/at-partner', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;
    return send(res, await fulfilment.dropAtPartner(order));
  } catch (err) {
    next(err);
  }
});

router.post('/ops/ready', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;
    return send(res, await fulfilment.markReady(order));
  } catch (err) {
    next(err);
  }
});

// Weighing sets the price and charges the card, so it answers with more than
// a status: the driver screen shows whether the money actually moved.
router.post('/ops/weight', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;

    const result = await fulfilment.recordWeight(order, req.body.weight_lb);

    if (!result.ok) {
      const illegal = result.reason === 'illegal';
      return res
        .status(illegal ? 409 : 400)
        .json({ error: illegal ? 'order_not_active' : 'weight_lb_invalid', detail: result.detail });
    }

    return res.json({
      ok: true,
      order_id: result.order.id,
      order_number: result.order.order_number,
      weight_lb: result.weightLb,
      price_cents: result.priceCents,
      price: money(result.priceCents),
      over_max_order: result.overMaxOrder,
      // A declined card is not the driver's problem to solve, but
      // "keep going, we will chase it" is worth knowing.
      paid: result.paid,
      payment_note: result.paymentNote,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/ops/out-for-delivery', async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;
    return send(res, await fulfilment.outForDelivery(order));
  } catch (err) {
    next(err);
  }
});

router.post('/ops/delivered', upload.single('photo'), async (req, res, next) => {
  try {
    const order = await loadOrder(req, res);
    if (!order) return;

    const result = await fulfilment.deliver(order, req.file);
    return send(res, result, result.ok ? { photo: result.photo, payment_status: order.payment_status } : {});
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
// POST /ops/cron/recurring — book tomorrow's standing orders
//
// Run once a day by Railway's scheduler, or by hand while testing. Not a job
// queue, which stays on the do-not-build list: one endpoint, behind the same
// admin key as everything else here, doing one pass.
//
// Safe to run twice, ten times, or at any hour. It books nothing for anybody
// who already has a pickup waiting, so a double-fire is a no-op rather than a
// double booking and a double charge.
// ---------------------------------------------------------------------------

router.post('/ops/cron/recurring', async (req, res, next) => {
  try {
    // A date can be passed in to test a specific day. Without one it does
    // tomorrow, which is the point: the warning text lands the evening before.
    const result = await recurring.bookDue({ date: req.body && req.body.date });

    res.json({
      ok: true,
      date: result.date,
      booked: result.booked.map((o) => ({ order_number: o.order_number, customer_id: o.customer_id })),
      // Anything that could not be booked, with why. A customer whose card
      // died should show up here rather than silently stop getting laundry.
      not_booked: result.failed.map((f) => ({ phone: f.customer.phone, reason: f.reason })),
    });
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
        pickup_window: booking.arrivalWindow(o),

        // A booking is only confirmed once the minimum has actually cleared.
        // Orders that predate the minimum have no deposit and count as
        // confirmed, because they were taken under the old rules.
        confirmed: Boolean(o.deposit_paid_at) || o.deposit_cents == null,
        deposit_paid: Boolean(o.deposit_paid_at),

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
      // Only bookings that were actually paid for.
      //
      // An order with no minimum taken is not confirmed: the customer was sent
      // a card link and never finished. Nobody should drive to that door.
      // They are listed separately so they are chased rather than lost.
      pickups: all.filter(
        (o) => orders.AWAITING_COLLECTION.includes(o.status) && o.pickup_date <= today && o.confirmed
      ),
      unconfirmed: all.filter((o) => orders.AWAITING_COLLECTION.includes(o.status) && !o.confirmed),
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
