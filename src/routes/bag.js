'use strict';

const express = require('express');

const db = require('../db');
const bags = require('../core/bags');
const fulfilment = require('../core/fulfilment');
const throttle = require('../core/throttle');
const issues = require('../core/issues');
const orderEvents = require('../core/order-events');
const partnersCore = require('../core/partners');
const { config } = require('../config');
const { sendAndLog } = require('../core/notify');
const { site } = require('../web/site');
const { escapeHtml, CSS_BASE, logo } = require('../web/layout');

const router = express.Router();

// ---------------------------------------------------------------------------
// /o/<code> - the page behind the QR on a bag.
//
// This is the only page in the system with NO LOGIN AT ALL. Anybody who can
// point a camera at a sticker reaches it, which is the entire point: the
// laundromat behind the counter has whatever cracked Android they have, and
// asking them to install something or remember a password is asking them not
// to bother.
//
// So the whole design is about what it is safe to put on a page like that.
//
// WHAT IT SHOWS: the bag's code, which bag of how many, how it should be
// washed, when it is due back, and nothing else.
//
// WHAT IT NEVER SHOWS: the customer's name, their phone number, their address,
// what they have ordered before, or what they paid. A laundromat needs to know
// how to wash a bag. It does not need to know whose bag it is, and once that
// information is not on the page it cannot leak from it.
//
// Three things keep it closed:
//   - the code is one of a billion and is never sequential
//   - the QR carries a signature, so a guessed URL is refused before the
//     database is touched
//   - it only resolves while the label is actually on a live bag. The moment
//     the order is delivered the binding is released and this page goes blank,
//     so a sticker out of a bin is worth nothing.
//
// Every hit is logged, resolved or not, because a page with no login needs
// some record of who reached it.
// ---------------------------------------------------------------------------

// Generous, because a partner may legitimately rescan the same bag several
// times, and mean, because this is an unauthenticated lookup. Per IP.
const SCAN_LIMIT = 60;
const SCAN_WINDOW_MS = 15 * 60 * 1000;

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

// The wash, in the words a person at a machine needs.
//
// THIS IS AN ALLOWLIST, AND THAT IS THE WHOLE SECURITY MODEL OF THE PAGE.
//
// Only these five structured fields are ever rendered. FREE TEXT NEVER CROSSES
// - not special_instructions, not dropoff_spot, not notes on the order, no
// matter how laundry-ish it looks.
//
// This is not theoretical. A real customer's saved preferences contain
// "Deliver to 16-51 Chandler Dr, Fair Lawn, NJ" in a free-text field, and
// somebody typing "separate the shirts with the Bergen Pediatrics name tags"
// would hand a stranger their employer. No regex catches the second one -
// there is no pattern for a company name - so the fix cannot be redaction. It
// has to be that the field is never printed here at all.
//
// If a genuine instruction does not fit these five, the driver says it out
// loud when he hands the bag over. That is the interface to a laundromat.
function washLines(preferences) {
  const p = preferences || {};
  const out = [];

  if (p.water_temp) out.push(['Water', String(p.water_temp).toLowerCase()]);
  out.push(['Detergent', p.detergent === 'HYPOALLERGENIC' ? 'Hypoallergenic' : 'Standard']);
  out.push(['Softener', p.fabric_softener ? 'Yes' : 'No']);
  if (p.hang_dry) out.push(['Drying', 'Hang dry, do not tumble']);
  if (p.separate_darks) out.push(['Sorting', 'Wash darks separately']);

  return out;
}

// The one thing a laundromat may write.
//
// NEIL'S CALL, and it needs stating precisely because it looks like the
// opposite of a rule elsewhere in the codebase. Both scales get recorded; only
// ours bills. A partner weighs the bag anyway for their own invoice, so asking
// for that figure costs them nothing and catches a bad scale on either side -
// the customer certain their bag was not 40 lb, and the laundromat whose
// invoice says 44.
//
// What it does NOT do is set a price. `partner_weight_lb` is never read by the
// pricing code, and if it ever is, the control Neil asked for two sessions ago
// has been removed: a partner scale reading 400 instead of 40 would be a
// $1,000 charge on a customer's card with nobody of ours in between.
function weightCard(order, code, token, justSaved) {
  const ours = order.weight_lb == null ? null : Number(order.weight_lb);
  const theirs = order.partner_weight_lb == null ? null : Number(order.partner_weight_lb);

  if (theirs != null) {
    // Asks the same function the issue-raising does, rather than carrying its
    // own idea of "too far apart". This said "more than a pound" while the
    // real tolerance was 2 lb or 5% of the bag, so a laundromat could be told
    // it had been flagged when it had not.
    const check = partnersCore.compareWeights(order);
    const disagrees = Boolean(check && check.overThreshold);

    return `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 10px;">Your weight</p>
      <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1.1;">
        ${escapeHtml(theirs.toFixed(1))} lb
      </div>
      <p style="font-size:15px;color:var(--ink-700);line-height:1.6;margin:12px 0 0;">
        ${
          disagrees
            ? 'Thanks. That is further from our figure than we allow for two scales, so it has been flagged for someone to check. Nothing for you to do.'
            : 'Thanks, that matches ours.'
        }
      </p>
    </div>`;
  }

  return `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 10px;">What did it weigh?</p>
      <p style="font-size:15px;color:var(--ink-700);line-height:1.6;margin:0 0 18px;">
        Your own figure, off your scale. We have already weighed it too - this
        is a cross-check so a bad scale gets spotted, and it does not change
        what anybody is charged.
      </p>
      ${
        justSaved === 'bad'
          ? `<p style="margin:0 0 14px;padding:12px 15px;border:2px solid var(--ink-900);border-radius:12px;
                       background:var(--stain-500);color:var(--paper-050);font-weight:600;">
               That did not look like a weight in pounds.
             </p>`
          : ''
      }
      <form method="post" action="/o/${encodeURIComponent(code)}/weight?t=${encodeURIComponent(token || '')}"
            style="display:flex;gap:12px;align-items:flex-start;">
        <input class="input input-lg" type="number" name="weight_lb" required
               step="0.1" min="0.1" max="200" inputmode="decimal" placeholder="Pounds"
               style="flex:1;">
        <button type="submit" class="btn btn-lg">Save</button>
      </form>
    </div>`;
}

// The other thing a laundromat needs to be able to say: it is done.
//
// Without this there is no way for them to tell us, and the driver is left
// ringing round or guessing - which is the whole reason a bag sits finished on
// a shelf for half a day. It is the second of the two events worth asking a
// partner for, the first being the weight above. Everything else about how a
// bag moves is ours to record.
//
// It is deliberately ONE BUTTON with no options. A laundromat is not going to
// maintain a pipeline of washing, drying and folding, and asking them to would
// mean four statuses that rot at the first one while somebody debugs staff
// compliance instead of software.
function readyCard(order, code, token) {
  if (order.status === 'READY') {
    return `
    <div class="card" style="padding:28px;margin-bottom:20px;background:var(--suds-500);">
      <p class="eyebrow" style="margin:0 0 8px;">Marked ready</p>
      <div style="font-family:var(--font-display);font-weight:900;font-size:26px;line-height:1.15;">
        Thanks - we're on our way
      </div>
      <p style="font-size:15px;line-height:1.6;margin:12px 0 0;">
        Our driver has been told. Nothing else to do.
      </p>
    </div>`;
  }

  // Only while the bag is actually with them. Before that it is still in our
  // van, and after collection there is nothing to declare.
  if (order.status !== 'AT_PARTNER') return '';

  return `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 10px;">Finished it?</p>
      <p style="font-size:15px;color:var(--ink-700);line-height:1.6;margin:0 0 18px;">
        Tell us it is washed, dried and folded and we will come and collect it.
      </p>
      <form method="post" action="/o/${encodeURIComponent(code)}/ready?t=${encodeURIComponent(token || '')}"
            style="margin:0;">
        <button type="submit" class="btn btn-lg btn-full">Ready for collection</button>
      </form>
    </div>`;
}

function page({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} &middot; ${escapeHtml(site.name)}</title>
  <!-- Never indexed. It is a page about somebody's laundry. -->
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#101210">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Grandstander:wght@900&display=swap">
  <link rel="stylesheet" href="${CSS_BASE}/ds/styles.css">
  <link rel="stylesheet" href="${CSS_BASE}/icons.css">
  <link rel="stylesheet" href="${CSS_BASE}/lyndry.css">
</head>
<body>
  <main class="container" style="max-width:560px;padding-top:28px;padding-bottom:64px;">
    <div style="margin-bottom:26px;">${logo('compact')}</div>
    ${body}
  </main>
</body>
</html>`;
}

// One answer for every kind of miss.
//
// A scanned sticker that is blank, a sticker from a finished order, and a code
// somebody invented all say the same thing. Telling them apart would turn this
// page into a way of finding out which codes are real.
function nothingHere() {
  return page({
    title: 'Nothing here',
    body: `
    <div class="card" style="padding:28px;">
      <p class="eyebrow" style="margin:0 0 8px;">Bag label</p>
      <h1 style="font-size:30px;line-height:1.1;margin:0 0 14px;">This label isn't in use.</h1>
      <p style="margin:0;color:var(--ink-700);line-height:1.6;">
        It hasn't been put on a bag yet, or the order it was on is finished.
        Either way there's nothing to show. If you're holding a bag that needs
        collecting, call us on ${escapeHtml(site.publicPhoneDisplay)}.
      </p>
    </div>`,
  });
}

router.get('/o/:code', async (req, res, next) => {
  const raw = req.params.code;
  const ip = clientIp(req);
  const userAgent = req.headers['user-agent'] || null;

  try {
    // hit() returns TRUE when the caller has gone over the limit. Reads
    // backwards, which is exactly how this got written the wrong way round the
    // first time and refused every genuine scan.
    if (throttle.hit(`labelscan:${ip}`, SCAN_LIMIT, SCAN_WINDOW_MS)) {
      await bags.recordScan({ code: raw, outcome: 'THROTTLED', ip, userAgent });
      return res.status(429).type('html').send(nothingHere());
    }

    const code = bags.normaliseCode(raw);

    // Refused before the database is touched. A guessed URL costs us a hash
    // and nothing else.
    if (!code || !bags.verifyCode(code, req.query.t)) {
      await bags.recordScan({ code: raw, outcome: 'BAD_TOKEN', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    const label = await bags.findByCode(code);

    if (!label) {
      await bags.recordScan({ code, outcome: 'UNKNOWN', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    // released_at is what retires a sticker. order_id stays set after delivery
    // so the ops screens can still show which codes were on the bag, so it is
    // no longer enough on its own to tell a live label from a finished one.
    if (!label.order_id || label.released_at) {
      await bags.recordScan({ code, outcome: 'UNBOUND', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    // Only the columns this page is allowed to show. Selecting the whole row
    // and then being careful in the template is how a phone number ends up on
    // a stranger's screen the day somebody adds a field.
    const { data: order, error } = await db
      .from('orders')
      .select(
        'id, order_number, status, collected_at, weight_lb, partner_weight_lb, customers(preferences)'
      )
      .eq('id', label.order_id)
      .maybeSingle();

    if (error) throw error;

    if (!order) {
      await bags.recordScan({ code, outcome: 'UNBOUND', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    // BELT AND BRACES. Delivering an order releases its labels, so a finished
    // bag's sticker should already point at nothing - but that is a write that
    // can fail, and an order delivered before this check existed never had it
    // run at all. A sticker on a bag that is back with its owner must not open
    // a page about it, and this is the half that cannot silently not happen.
    if (['DELIVERED', 'CANCELED'].includes(order.status)) {
      await bags.recordScan({ code, orderId: order.id, outcome: 'UNBOUND', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    const siblings = await bags.forOrder(order.id);
    const total = siblings.length || 1;

    await bags.recordScan({ code, orderId: order.id, outcome: 'SHOWN', ip, userAgent });

    const wash = washLines((order.customers || {}).preferences);

    // A countdown rather than a date. "13h 40m left" is what somebody deciding
    // which machine to load next actually needs; "back by Thursday" is not.
    const clock = fulfilment.turnaround(order);

    return res.type('html').send(
      page({
        title: `Bag ${code}`,
        body: `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 8px;">Bag label</p>
      <div style="font-family:var(--font-mono);font-size:38px;font-weight:700;letter-spacing:0.06em;line-height:1;">
        ${escapeHtml(code)}
      </div>
      <div style="font-family:var(--font-mono);font-size:14px;color:var(--ink-500);margin-top:10px;">
        Bag ${label.position || 1} of ${total} &middot; Order #${escapeHtml(String(order.order_number))}
      </div>
    </div>

    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 14px;">How to wash it</p>
      <dl style="display:grid;grid-template-columns:auto 1fr;gap:10px 22px;margin:0;font-size:16px;">
        ${wash
          .map(
            ([k, v]) =>
              `<dt style="color:var(--ink-500);">${escapeHtml(k)}</dt>` +
              `<dd style="margin:0;font-weight:700;">${escapeHtml(v)}</dd>`
          )
          .join('')}
      </dl>
    </div>

    <div class="card" style="padding:28px;margin-bottom:20px;background:${
      clock && clock.urgent ? 'var(--stain-500)' : 'var(--sunbeam-500)'
    };${clock && clock.urgent ? 'color:var(--paper-050);' : ''}">
      <p class="eyebrow" style="margin:0 0 8px;${
        clock && clock.urgent ? 'color:var(--paper-050);' : ''
      }">Time to turn it around</p>
      <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1.1;">
        ${escapeHtml(clock ? clock.text : 'Not picked up yet')}
      </div>
    </div>

    ${weightCard(order, code, req.query.t, req.query.weighed)}

    ${readyCard(order, code, req.query.t)}

    <p style="font-size:14px;color:var(--ink-500);line-height:1.6;margin-top:22px;">
      Questions about this bag: ${escapeHtml(site.publicPhoneDisplay)}.
    </p>`,
      })
    );
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /o/<code>/weight - the laundromat's own figure
//
// The only write on the whole public surface, and it is deliberately tiny: one
// number, onto one order, that nothing prices anything from.
//
// It goes through exactly the same gate as the page - the signature, the
// binding, the live-order check - because a form action is a URL like any
// other and "they must have come from the page" is not a check.
// ---------------------------------------------------------------------------

const WEIGH_LIMIT = 20;

router.post('/o/:code/weight', async (req, res, next) => {
  const raw = req.params.code;
  const ip = clientIp(req);
  const userAgent = req.headers['user-agent'] || null;

  try {
    if (throttle.hit(`labelweigh:${ip}`, WEIGH_LIMIT, SCAN_WINDOW_MS)) {
      await bags.recordScan({ code: raw, outcome: 'THROTTLED', ip, userAgent });
      return res.status(429).type('html').send(nothingHere());
    }

    const code = bags.normaliseCode(raw);
    if (!code || !bags.verifyCode(code, req.query.t)) {
      await bags.recordScan({ code: raw, outcome: 'BAD_TOKEN', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    const label = await bags.findByCode(code);
    if (!label || !label.order_id || label.released_at) {
      await bags.recordScan({ code, outcome: 'UNBOUND', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    // The customer comes along only so an issue can be raised against them if
    // the two scales disagree. Nothing about them is rendered on this page.
    const { data: order, error } = await db
      .from('orders')
      .select('id, order_number, status, weight_lb, partner_weight_lb, customers(id, name, phone)')
      .eq('id', label.order_id)
      .maybeSingle();

    if (error) throw error;

    if (!order || ['DELIVERED', 'CANCELED'].includes(order.status)) {
      await bags.recordScan({ code, orderId: order && order.id, outcome: 'UNBOUND', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    const back = `/o/${encodeURIComponent(code)}?t=${encodeURIComponent(String(req.query.t || ''))}`;
    const weight = Number((req.body || {}).weight_lb);

    if (!Number.isFinite(weight) || weight <= 0 || weight > 200) {
      return res.redirect(303, `${back}&weighed=bad`);
    }

    // First answer wins. Somebody re-scanning a sticker should not be able to
    // quietly revise a figure that has already been compared against ours.
    if (order.partner_weight_lb != null) return res.redirect(303, back);

    await db
      .from('orders')
      .update({ partner_weight_lb: weight, partner_weight_at: new Date().toISOString() })
      .eq('id', order.id);

    // Two scales are never going to agree exactly. More than a pound apart is
    // worth a person looking at, and it goes on the Issues screen rather than
    // into a log nobody reads - a bad scale in either direction is money.
    const ours = order.weight_lb == null ? null : Number(order.weight_lb);
    const check = partnersCore.compareWeights({ weight_lb: ours, partner_weight_lb: weight });

    await orderEvents.record(order.id, {
      kind: 'PARTNER_WEIGHT',
      summary: check
        ? `Laundromat weighed it ${weight} lb, ${check.absolute.toFixed(1)} lb ${
            check.heavier ? 'heavier' : 'lighter'
          } than ours`
        : `Laundromat weighed it ${weight} lb`,
      was: ours == null ? null : `${ours} lb`,
      became: `${weight} lb`,
      by: { actor: 'partner' },
      reason: check && check.overThreshold ? 'Outside the tolerance, so an issue was raised' : null,
    });

    if (check && check.overThreshold && order.customers) {
      await issues
        .raise({
          customer: order.customers,
          order,
          reason:
            `Scales disagree: we weighed it ${ours} lb, the laundromat says ${weight} lb - ` +
            `${check.absolute.toFixed(1)} lb apart, and we allow ${check.tolerance.toFixed(1)}. ` +
            `Ours is what was charged. Check which scale is wrong before it happens again.`,
        })
        .catch((err) => console.error(`Could not raise a weight mismatch: ${err.message}`));
    }

    await bags.recordScan({ code, orderId: order.id, outcome: 'SHOWN', ip, userAgent });
    return res.redirect(303, back);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /o/<code>/ready - the laundromat says it is done
//
// Goes through fulfilment.markReady like every other caller, so the state
// machine still refuses anything illegal and there is one implementation of
// what "ready" means. A partner cannot skip a step or move an order anywhere
// else; the only transition this can cause is AT_PARTNER to READY.
//
// AND IT TEXTS WHOEVER WORKS ORDERS. A status that only lands on a screen
// nobody is watching is not "letting us know" - the bag would still sit on a
// shelf until somebody happened to refresh the board. One message, to the
// people who can actually go and collect it.
// ---------------------------------------------------------------------------

router.post('/o/:code/ready', async (req, res, next) => {
  const raw = req.params.code;
  const ip = clientIp(req);
  const userAgent = req.headers['user-agent'] || null;

  try {
    if (throttle.hit(`labelready:${ip}`, WEIGH_LIMIT, SCAN_WINDOW_MS)) {
      await bags.recordScan({ code: raw, outcome: 'THROTTLED', ip, userAgent });
      return res.status(429).type('html').send(nothingHere());
    }

    const code = bags.normaliseCode(raw);
    if (!code || !bags.verifyCode(code, req.query.t)) {
      await bags.recordScan({ code: raw, outcome: 'BAD_TOKEN', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    const label = await bags.findByCode(code);
    if (!label || !label.order_id || label.released_at) {
      await bags.recordScan({ code, outcome: 'UNBOUND', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    const { data: order, error } = await db
      .from('orders')
      .select('*, customers(id, name, phone, address_line1, city)')
      .eq('id', label.order_id)
      .maybeSingle();

    if (error) throw error;

    if (!order || ['DELIVERED', 'CANCELED'].includes(order.status)) {
      await bags.recordScan({ code, orderId: order && order.id, outcome: 'UNBOUND', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    const back = `/o/${encodeURIComponent(code)}?t=${encodeURIComponent(String(req.query.t || ''))}`;

    // Already done. Tapping twice is somebody making sure, not an error.
    if (order.status === 'READY') return res.redirect(303, back);

    const result = await fulfilment.markReady(order, { by: { actor: 'partner' } });
    if (!result.ok) return res.redirect(303, back);

    await bags.recordScan({ code, orderId: order.id, outcome: 'SHOWN', ip, userAgent });

    // Best effort. A texting failure must not make the laundromat think their
    // tap did not register - the status has already changed and the board
    // already shows it.
    try {
      const numbers = await issues.alertRecipients('orders.act');
      const where = order.partner_id ? await partnerName(order.partner_id) : null;

      const body =
        `Order #${order.order_number} is ready for collection` +
        (where ? ` at ${where}` : '') +
        `. ${order.weight_lb ? `${order.weight_lb} lb. ` : ''}Collect it at ${config.baseUrl}/ops`;

      for (const to of numbers) await sendAndLog(to, body, null);

      if (!numbers.length) {
        console.error(`Order #${order.order_number} was marked ready and nobody could be told.`);
      }
    } catch (err) {
      console.error(`Could not announce a ready order: ${err.message}`);
    }

    return res.redirect(303, back);
  } catch (err) {
    return next(err);
  }
});

// Just the name, for the text. A whole partner row is not needed to write one
// sentence, and asking for one would put their rates in scope for no reason.
async function partnerName(partnerId) {
  const { data } = await db.from('partners').select('name').eq('id', partnerId).maybeSingle();
  return data ? data.name : null;
}

module.exports = router;
