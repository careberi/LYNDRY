'use strict';

const express = require('express');

const db = require('../db');
const bags = require('../core/bags');
const fulfilment = require('../core/fulfilment');
const throttle = require('../core/throttle');
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
// Read from the customer's saved preferences, but only these four fields. The
// preferences object is handed here whole and it would be easy to print all of
// it; naming the fields one at a time is what stops a future field - a gate
// code, a phone number, a "leave it with my neighbour Sarah" - appearing on a
// stranger's screen because somebody added it upstream.
function washLines(preferences) {
  const p = preferences || {};
  const out = [];

  if (p.water_temp) out.push(['Water', String(p.water_temp).toLowerCase()]);
  out.push(['Detergent', p.detergent === 'HYPOALLERGENIC' ? 'Hypoallergenic' : 'Standard']);
  out.push(['Softener', p.fabric_softener ? 'Yes' : 'No']);

  return out;
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

    if (!label.order_id) {
      await bags.recordScan({ code, outcome: 'UNBOUND', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    // Only the columns this page is allowed to show. Selecting the whole row
    // and then being careful in the template is how a phone number ends up on
    // a stranger's screen the day somebody adds a field.
    const { data: order, error } = await db
      .from('orders')
      .select('id, order_number, status, collected_at, weight_lb, customers(preferences)')
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

    <div class="card" style="padding:28px;background:${
      clock && clock.urgent ? 'var(--stain-500)' : 'var(--sunbeam-500)'
    };${clock && clock.urgent ? 'color:var(--paper-050);' : ''}">
      <p class="eyebrow" style="margin:0 0 8px;${
        clock && clock.urgent ? 'color:var(--paper-050);' : ''
      }">Time to turn it around</p>
      <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1.1;">
        ${escapeHtml(clock ? clock.text : 'Not picked up yet')}
      </div>
    </div>

    <p style="font-size:14px;color:var(--ink-500);line-height:1.6;margin-top:22px;">
      Questions about this bag: ${escapeHtml(site.publicPhoneDisplay)}.
    </p>`,
      })
    );
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
