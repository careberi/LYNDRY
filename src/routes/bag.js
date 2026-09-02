'use strict';

const express = require('express');

const db = require('../db');
const bags = require('../core/bags');
const fulfilment = require('../core/fulfilment');
const tags = require('../core/tags');
const wash = require('../core/wash');
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
  // One definition, in src/core/wash.js, shared with the AI's tool schema, the
  // pricing and the account page. An option cannot exist in one of them and not
  // another, which is how a customer ends up choosing something the people
  // doing the washing never see.
  return wash.washLines(preferences);
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
function weightCard(label, order, siblings, code, token, justSaved) {
  // ONE BAG AT A TIME. A laundromat weighs what is in front of them, and that
  // is a bag - so the figure belongs on the bag. It used to be written to the
  // order, so typing a weight against bag 1 set it for the whole order and bag
  // 2's page showed the same number back as though it had been weighed too.
  const theirs = label.partner_weight_lb == null ? null : Number(label.partner_weight_lb);

  const total = siblings.length;
  const done = siblings.filter((b) => b.partner_weight_lb != null).length;

  if (theirs != null) {
    const allIn = done === total;

    // The comparison that means anything is TOTAL against TOTAL: everything
    // they weighed against the one number our driver wrote down. Comparing a
    // half-weighed order against a full one flags every laundromat as light.
    const theirTotal = siblings.reduce((t, b) => t + Number(b.partner_weight_lb || 0), 0);
    const check = allIn
      ? partnersCore.compareWeights({
          weight_lb: order.weight_lb,
          partner_weight_lb: theirTotal,
        })
      : null;

    return `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 10px;">This bag</p>
      <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1.1;">
        ${escapeHtml(theirs.toFixed(1))} lb
      </div>
      <p style="font-size:15px;color:var(--ink-700);line-height:1.6;margin:12px 0 0;">
        ${
          allIn
            ? check && check.overThreshold
              ? `Thanks. All ${total} bags come to ${escapeHtml(theirTotal.toFixed(1))} lb on your scale. ` +
                'That is further from our figure than we allow for two scales, so it has been ' +
                'flagged for someone to check. Nothing for you to do.'
              : `Thanks. All ${total} bags come to ${escapeHtml(theirTotal.toFixed(1))} lb, which matches ours.`
            : `Thanks. ${done} of ${total} bags weighed - scan the ${
                total - done === 1 ? 'other one' : `other ${total - done}`
              } and we will compare the totals.`
        }
      </p>
    </div>`;
  }

  // NOT UNTIL IT IS ACTUALLY WITH THEM.
  //
  // Before the driver hands it over the bag is in our van, and a weight typed
  // against it is somebody scanning a sticker they are holding rather than a
  // laundromat weighing work they have taken in. The form was rendered
  // regardless of status, so a bag could be "weighed by the laundromat" while
  // it was still on the road.
  // A DELIVERY BAG IS THEIR OWN PACKING. They weighed what we handed them; the
  // bags they packed afterwards are not a second thing for them to weigh, and
  // a figure against one would never be compared to anything.
  if ((label.leg || 'PICKUP') === 'DELIVERY') return '';

  if (order.status !== 'AT_PARTNER') {
    return `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 10px;">Not with you yet</p>
      <p style="font-size:15px;color:var(--ink-700);line-height:1.6;margin:0;">
        We will ask you to weigh this once our driver has handed it over.
      </p>
    </div>`;
  }

  return `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 10px;">What did THIS bag weigh?</p>
      <p style="font-size:15px;color:var(--ink-700);line-height:1.6;margin:0 0 18px;">
        Your own figure, off your scale, for this bag only.
        ${
          total > 1
            ? `There ${total === 2 ? 'is 1 other bag' : `are ${total - 1} other bags`} on this order -
               scan each sticker and weigh them one at a time. We compare the totals.`
            : ''
        }
        We have already weighed it too; this is a cross-check so a bad scale gets
        spotted, and it does not change what anybody is charged.
      </p>
      ${
        justSaved === 'bad'
          ? `<p style="margin:0 0 14px;padding:12px 15px;border:2px solid var(--ink-900);border-radius:12px;
                       background:var(--stain-500);color:var(--paper-050);font-weight:600;">
               That did not look like a weight in pounds.
             </p>`
          : ''
      }
      ${
        justSaved === 'early'
          ? `<p style="margin:0 0 14px;padding:12px 15px;border:2px solid var(--ink-900);border-radius:12px;
                       background:var(--stain-500);color:var(--paper-050);font-weight:600;">
               That bag is not with you yet.
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

// ---------------------------------------------------------------------------
// What a laundromat sees when they scan an ORDER TAG.
//
// Every bag of the order carries this same code, so this is the whole job on
// one screen rather than one screen per bag: how many bags there are, how they
// are washed, how long there is, and the two things we need back from them.
//
// STILL A BLIND DROP-OFF. The code, the order number, how many bags, five
// structured wash fields and a countdown. No name, no address, no phone, no
// price, and no free text of any kind - a real saved preference reads "deliver
// to 16-51 Chandler Dr", so the page lists the fields it allows rather than
// trying to redact the ones it does not.
// ---------------------------------------------------------------------------
function orderTagPage(order, code, token, query = {}) {
  const wash = washLines((order.customers || {}).preferences);
  const clock = fulfilment.turnaround(order);
  const bagsIn = order.bag_count == null ? null : Number(order.bag_count);

  const t = encodeURIComponent(String(token || ''));
  const back = `/o/${encodeURIComponent(code)}?t=${t}`;

  const saidWeight = order.partner_weight_lb != null;
  const atPartner = order.status === 'AT_PARTNER';

  return page({
    title: `Order ${order.order_number}`,
    body: `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 8px;">Order tag</p>
      <div style="font-family:var(--font-mono);font-size:38px;font-weight:700;letter-spacing:0.06em;line-height:1;">
        ${escapeHtml(code)}
      </div>
      <div style="font-family:var(--font-mono);font-size:14px;color:var(--ink-500);margin-top:10px;">
        Order #${escapeHtml(String(order.order_number))}${
          bagsIn ? ` &middot; ${bagsIn} bag${bagsIn === 1 ? '' : 's'} came in` : ''
        }
      </div>
      <p style="font-size:15px;line-height:1.6;color:var(--ink-700);margin:14px 0 0;">
        Every bag of this order has this same tag on it.
      </p>
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
      <p style="font-size:15px;line-height:1.6;color:var(--ink-500);margin:18px 0 0;">
        The same for every bag of this order.
      </p>
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

    ${
      // ONE WEIGHT FOR THE WHOLE LOAD, and only while it is actually with them.
      // A laundromat weighs what goes in the machine, which is the load, not
      // each bag we happened to carry it in.
      !atPartner
        ? `<div class="card" style="padding:28px;margin-bottom:20px;">
             <p class="eyebrow" style="margin:0 0 8px;">Not with you yet</p>
             <p style="font-size:15px;line-height:1.6;margin:0;">
               Our driver has not handed this over yet. Nothing to do.
             </p>
           </div>`
        : saidWeight
          ? `<div class="card" style="padding:28px;margin-bottom:20px;">
               <p class="eyebrow" style="margin:0 0 8px;">Weight recorded</p>
               <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1.1;">
                 ${escapeHtml(Number(order.partner_weight_lb).toFixed(1))} lb
               </div>
               <p style="font-size:15px;line-height:1.6;margin:12px 0 0;">
                 Thanks, that is logged. Nothing else until it is ready.
               </p>
             </div>`
          : `<div class="card" style="padding:28px;margin-bottom:20px;">
               <p class="eyebrow" style="margin:0 0 8px;">What does it weigh?</p>
               <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">
                 The whole load, in pounds. We weigh it too, so this is a
                 cross-check that catches a bad scale on either side.
               </p>
               <form method="post" action="/o/${encodeURIComponent(code)}/weight?t=${t}"
                     style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
                 <div style="flex:1 1 160px;">
                   <label class="field-label" for="lw">Pounds</label>
                   <input class="field" id="lw" name="weight_lb" type="number" step="0.1"
                          min="0" max="400" inputmode="decimal" required>
                 </div>
                 <button class="btn btn-ink btn-lg" type="submit">${escapeHtml(t('Save'))}</button>
               </form>
               ${
                 query.weighed === 'bad'
                   ? `<p style="font-size:15px;color:var(--stain-500);margin:14px 0 0;">
                        That did not look like a weight. Pounds, as a number.
                      </p>`
                   : ''
               }
             </div>`
    }

    ${readyCard(order, code, token)}

    <p style="font-size:14px;color:var(--ink-500);line-height:1.6;margin-top:22px;">
      Questions about this order: ${escapeHtml(site.publicPhoneDisplay)}.
    </p>`,
  });
}

// ---------------------------------------------------------------------------
// THE BAG TAG PAGE, WHICH CHANGES WITH THE BAG.
//
// One sticker, scanned by two different people at four different moments. Each
// of them is shown the one thing they can do right now and nothing else:
//
//   at the door        the bag id, and a box for OUR weight
//   just arrived       the bag id, and a box for THEIRS - the instructions are
//                      behind it, which is what makes the weight get entered
//   being washed       the wash instructions, the sorting standard, the clock,
//                      and the four stickers to mark bags ready with
//   ready              a holding screen until the driver scans it into the van
//   in the van / done  a plain statement of where it is
//
// GATING THE INSTRUCTIONS BEHIND THE WEIGHT IS NEIL'S IDEA AND THE SHARPEST
// ONE HERE. The number we need is collected by the thing they want, rather
// than by asking nicely and hoping.
//
// STILL A BLIND DROP-OFF AT EVERY STAGE. The bag id, which bag of how many,
// structured wash fields and a countdown. No name, no address, no phone, no
// price, and no free text - a real saved preference reads "deliver to 16-51
// Chandler Dr", so the page lists the fields it allows rather than trying to
// redact the ones it does not.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ENGLISH AND SPANISH, AND ONLY ON THIS PAGE.
//
// NEIL'S CALL: most of the people working a laundromat counter speak Spanish,
// and this is the one screen we hand to somebody who does not work for us. It
// is deliberately not a site-wide feature - the ops screens are for our own
// staff and the marketing pages are a separate decision, so translating those
// would be scope nobody asked for and copy nobody maintains.
//
// A plain object rather than an i18n library. There are about thirty strings,
// they live on one page, and a dependency to look up thirty strings is a
// dependency to keep patched for the rest of the project's life.
//
// THE KEY IS THE ENGLISH. If a string is missing from the Spanish table the
// page falls back to English rather than showing a blank or a key name - a
// laundromat with half a page in front of them can still work; one looking at
// "wash.instructions.heading" cannot.
// ---------------------------------------------------------------------------

const ES = Object.freeze({
  'Bag tag': 'Etiqueta de bolsa',
  'Order': 'Pedido',
  'Questions about this bag': 'Preguntas sobre esta bolsa',

  // Stages
  'Not on a bag yet': 'Todavia sin bolsa',
  'Being collected': 'En recogida',
  'In the van': 'En la furgoneta',
  'Just arrived': 'Recien llegada',
  'Being washed': 'En lavado',
  'Ready for collection': 'Lista para recoger',
  'Back in the van': 'De vuelta en la furgoneta',
  'Delivered': 'Entregada',

  // Weighing
  'Weigh it to see the wash instructions': 'Pese la bolsa para ver las instrucciones',
  'Weigh the bag and enter the weight to see the wash instructions.':
    'Pese la bolsa y escriba el peso para ver las instrucciones de lavado.',
  'Pounds': 'Libras',
  'Save': 'Guardar',
  'That did not look like a weight. Pounds, as a number.':
    'Eso no parece un peso. Libras, en numero.',

  // Washing
  'How to wash it': 'Como lavarla',
  'How everything is sorted': 'Como se separa la ropa',
  'Time to turn it around': 'Tiempo para terminarla',
  'Not picked up yet': 'Aun no recogida',
  'When a bag is finished': 'Cuando termine una bolsa',
  'Waiting for collection': 'Esperando recogida',
  'Put one sticker on each bag you pack. Tap its number once to say you are using it, and again when that bag is finished.':
    'Ponga una pegatina en cada bolsa que empaque. Toque su numero una vez para indicar que la esta usando, y otra vez cuando esa bolsa este terminada.',
  'Tapped one by mistake? Keep tapping it and it goes back to not used.':
    'Toco uno por error? Sigalo tocando y vuelve a sin usar.',
  'This order is done': 'Este pedido esta terminado',
  'Only when every bag for this order is packed and finished. We will come and collect it.':
    'Solo cuando todas las bolsas de este pedido esten empacadas y terminadas. Pasaremos a recogerlo.',
  'Not used': 'Sin usar',
  'In use': 'En uso',
  'Done': 'Terminada',
  'Put one sticker off this tag on each finished bag, then tap its number here. However many bags this became - one, or four.':
    'Ponga una pegatina de esta etiqueta en cada bolsa terminada y toque su numero aqui. Sean las bolsas que sean, una o cuatro.',
  'Tap a number once its sticker is on a finished bag. Tapping the same one twice changes nothing.':
    'Toque un numero cuando su pegatina ya este en una bolsa terminada. Tocar el mismo dos veces no cambia nada.',

  // Wash fields, so the instructions themselves are readable
  'Detergent': 'Detergente',
  'Softener': 'Suavizante',
  'Water': 'Agua',
  'Standard scented': 'Con aroma normal',
  'Free & clear, fragrance-free': 'Sin fragancia',
  'No softener': 'Sin suavizante',
  'Fragrance-free': 'Sin fragancia',
  'Cold': 'Fria',
  'Warm': 'Tibia',
  'Hot': 'Caliente',

  // Sorting standard
  'Sort into whites/lights and colours/darks when practical.':
    'Separe blancos/claros de colores/oscuros cuando sea posible.',
  'Separate obvious delicates, heavily soiled items, and anything needing special care.':
    'Aparte las prendas delicadas, las muy sucias y todo lo que necesite cuidado especial.',
  "Never combine different customers' laundry.":
    'Nunca mezcle la ropa de clientes distintos.',
});

// Which language this visitor is reading in. The query string decides, and the
// choice is remembered in a cookie so somebody scanning twenty bags does not
// tap the toggle twenty times.
function langOf(req) {
  const asked = String((req.query || {}).lang || '').toLowerCase();
  if (asked === 'es' || asked === 'en') return asked;

  const cookie = String(req.headers.cookie || '');
  return /(?:^|;)\s*ly_lang=es(?:;|$)/.test(cookie) ? 'es' : 'en';
}

function translator(lang) {
  if (lang !== 'es') return (text) => text;

  return (text) => {
    const exact = ES[text];
    if (exact) return exact;

    // THE COUNTDOWN IS BUILT, NOT WRITTEN, so it can never be in the table:
    // fulfilment.turnaround() composes "1d 8h left" and "40m overdue" out of a
    // number and a word. Only the word needs translating, and doing it here
    // keeps the clock itself in one place rather than teaching fulfilment.js
    // about languages it has no other reason to know about.
    if (/\bleft$/.test(text)) return `quedan ${text.replace(/\s*left$/, '')}`;
    if (/\boverdue$/.test(text)) return `${text.replace(/\s*overdue$/, '')} de retraso`;

    return text;
  };
}

// The toggle. Keeps the signature on the URL - without ?t= the page refuses.
function langToggle(code, token, seq, lang) {
  const base = `/o/${encodeURIComponent(code)}?t=${encodeURIComponent(String(token || ''))}${
    seq ? `&s=${seq}` : ''
  }`;

  return `
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:14px;">
      <a class="btn btn-sm ${lang === 'en' ? '' : 'btn-outline'}" href="${base}&lang=en">English</a>
      <a class="btn btn-sm ${lang === 'es' ? '' : 'btn-outline'}" href="${base}&lang=es">Espanol</a>
    </div>`;
}

function stageHeader(label, order, stage, seq, t = (x) => x) {
  return `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 8px;">${escapeHtml(t('Bag tag'))}</p>
      <div style="font-family:var(--font-mono);font-size:38px;font-weight:700;letter-spacing:0.06em;line-height:1;">
        ${escapeHtml(label.code)}${seq ? `<span style="color:var(--ink-400);">-${seq}</span>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px;">
        <span class="badge" style="background:var(--sunbeam-500);">
          ${escapeHtml(t(tags.STAGE_LABEL[stage] || stage))}
        </span>
        <span style="font-family:var(--font-mono);font-size:13px;color:var(--ink-500);">
          ${escapeHtml(t('Order'))} #${escapeHtml(String(order.order_number))}
        </span>
      </div>
    </div>`;
}

function weightBox({ code, token, heading, blurb, action, error, t = (x) => x }) {
  return `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 8px;">${escapeHtml(t(heading))}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">${escapeHtml(t(blurb))}</p>
      <form method="post" action="${action}?t=${encodeURIComponent(String(token || ''))}"
            style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
        <div style="flex:1 1 160px;">
          <label class="field-label" for="w">${escapeHtml(t('Pounds'))}</label>
          <input class="field" id="w" name="weight_lb" type="number" step="0.1" min="0" max="400"
                 inputmode="decimal" autofocus required>
        </div>
        <button class="btn btn-ink btn-lg" type="submit">${escapeHtml(t('Save'))}</button>
      </form>
      ${
        error
          ? `<p style="font-size:15px;color:var(--stain-500);margin:14px 0 0;">
               ${escapeHtml(t('That did not look like a weight. Pounds, as a number.'))}
             </p>`
          : ''
      }
    </div>`;
}

function bagTagPage(label, order, code, token, query, lang = 'en', stickers = []) {
  const stage = tags.stageOf(label, order);
  const t = encodeURIComponent(String(token || ''));
  const seq = query.s && /^[1-4]$/.test(String(query.s)) ? Number(query.s) : null;
  const bad = query.weighed === 'bad';

  // `say` rather than `t`, because `t` is already the URL token on this page
  // and two things called t in one function is how a bug gets written.
  const say = translator(lang);

  const header =
    langToggle(code, token, seq, lang) + stageHeader(label, order, stage, seq, say);

  const footer = `
    <p style="font-size:14px;color:var(--ink-500);line-height:1.6;margin-top:22px;">
      ${escapeHtml(say('Questions about this bag'))}: ${escapeHtml(site.publicPhoneDisplay)}.
    </p>`;

  // --- at the customer's door: our own weight ------------------------------
  if (stage === tags.STAGES.TO_WEIGH) {
    return page({
      title: `Bag ${code}`,
      body: header + weightBox({
        code, token, error: bad, t: say,
        heading: 'What does this bag weigh?',
        blurb: 'Put it on the scale and type what it says. This is the number that prices the order.',
        action: `/o/${encodeURIComponent(code)}/weight`,
      }) + footer,
    });
  }

  // --- just arrived at the laundromat: their weight unlocks the wash -------
  if (stage === tags.STAGES.TO_WEIGH_AT_PARTNER) {
    return page({
      title: `Bag ${code}`,
      body: header + weightBox({
        code, token, error: bad, t: say,
        heading: 'Weigh it to see the wash instructions',
        // AN INSTRUCTION, NOT AN EXPLANATION. This said whose scale to use and
        // why we check it, which is our reasoning rather than their next move.
        // The person reading it is standing at a counter with a bag; they need
        // to know what to do, and the rest is ours to worry about.
        blurb: 'Weigh the bag and enter the weight to see the wash instructions.',
        action: `/o/${encodeURIComponent(code)}/weight`,
      }) + footer,
    });
  }

  // --- being washed: the instructions, and the four stickers ---------------
  if (stage === tags.STAGES.WASHING) {
    const lines = wash.washLines((order.customers || {}).preferences);
    const clock = fulfilment.turnaround(order);

    return page({
      title: `Bag ${code}`,
      body: header + `
    <div class="card" style="padding:28px;margin-bottom:20px;">
      <p class="eyebrow" style="margin:0 0 14px;">${escapeHtml(say('How to wash it'))}</p>
      <dl style="display:grid;grid-template-columns:auto 1fr;gap:10px 22px;margin:0;font-size:16px;">
        ${lines
          .map(([k, v]) =>
            `<dt style="color:var(--ink-500);">${escapeHtml(say(k))}</dt>` +
            `<dd style="margin:0;font-weight:700;">${escapeHtml(say(v))}</dd>`)
          .join('')}
      </dl>
    </div>

    <div class="card" style="padding:28px;margin-bottom:20px;background:var(--paper-200);">
      <p class="eyebrow" style="margin:0 0 12px;">${escapeHtml(say('How everything is sorted'))}</p>
      <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.7;">
        ${wash.SORTING.map((l) => `<li>${escapeHtml(say(l))}</li>`).join('')}
      </ul>
    </div>

    <div class="card" style="padding:28px;margin-bottom:20px;background:${
      clock && clock.urgent ? 'var(--stain-500)' : 'var(--sunbeam-500)'
    };${clock && clock.urgent ? 'color:var(--paper-050);' : ''}">
      <p class="eyebrow" style="margin:0 0 8px;${clock && clock.urgent ? 'color:var(--paper-050);' : ''}">
        ${escapeHtml(say('Time to turn it around'))}
      </p>
      <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1.1;">
        ${escapeHtml(clock ? say(clock.text) : say('Not picked up yet'))}
      </div>
    </div>

    <div class="card" style="padding:28px;">
      <p class="eyebrow" style="margin:0 0 8px;">${escapeHtml(say('When a bag is finished'))}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 18px;">
        ${escapeHtml(say('Put one sticker on each bag you pack. Tap its number once to say you are using it, and again when that bag is finished.'))}
      </p>

      <!-- A TWO BY TWO GRID, not a wrapping row. Flex-wrap sized each button by
           its own content, so three fitted on the first line and the fourth
           stretched across the second on its own - four identical stickers
           drawn four different sizes. They are the same object; they look it. -->
      <form method="post" action="/o/${encodeURIComponent(code)}/ready?t=${t}"
            style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${stickers
          .map(({ seq, state }) => {
            // COLOUR SAYS WHICH STATE, so one tap can mean "advance this" and
            // the attendant never has to guess what tapping will do.
            const look = {
              UNUSED: 'background:var(--paper-000);',
              IN_USE: 'background:var(--sunbeam-500);',
              DONE: 'background:var(--suds-500);',
            }[state];

            const word = { UNUSED: 'Not used', IN_USE: 'In use', DONE: 'Done' }[state];

            return `
        <button type="submit" name="seq" value="${seq}"
                style="width:100%;padding:16px 10px;border:2px solid var(--ink-900);
                       border-radius:12px;box-shadow:var(--shadow-pop-xs);cursor:pointer;${look}">
          <span style="display:block;font-family:var(--font-mono);font-weight:700;font-size:17px;">
            ${escapeHtml(code)}-${seq}
          </span>
          <span style="display:block;font-family:var(--font-mono);font-size:11px;letter-spacing:0.08em;
                       text-transform:uppercase;margin-top:4px;">
            ${escapeHtml(say(word))}
          </span>
        </button>`;
          })
          .join('')}
      </form>

      ${
        // THE ATTENDANT SAYS WHEN IT IS FINISHED, rather than the system
        // inferring it from the stickers. It used to become ready the moment
        // every intake bag had one finished bag against it, which assumes one
        // bag in becomes one bag out and stops watching. Only the person
        // folding knows whether they are still folding.
        stickers.some((x) => x.state === 'DONE')
          ? `<form method="post" action="/o/${encodeURIComponent(code)}/ready?t=${t}"
                   style="margin-top:22px;padding-top:20px;border-top:2px solid var(--ink-100);">
               <button class="btn btn-primary btn-lg btn-full" type="submit" name="order" value="done">
                 ${escapeHtml(say('This order is done'))}
               </button>
               <p class="field-hint" style="margin-top:12px;">
                 ${escapeHtml(say('Only when every bag for this order is packed and finished. We will come and collect it.'))}
               </p>
             </form>`
          : ''
      }
      <p class="field-hint" style="margin-top:14px;">
        ${escapeHtml(say('Tapped one by mistake? Keep tapping it and it goes back to not used.'))}
      </p>
    </div>` + footer,
    });
  }

  // --- ready: a holding screen until the driver takes it -------------------
  if (stage === tags.STAGES.READY) {
    return page({
      title: `Bag ${code}`,
      body: header + `
    <div class="card" style="padding:32px;text-align:center;">
      <div style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1.15;margin-bottom:12px;">
        ${escapeHtml(say('Waiting for collection'))}
      </div>
      <p style="font-size:16px;line-height:1.6;margin:0;">
        This one is marked finished and our driver has been told. Nothing else
        to do with it.
      </p>
    </div>` + footer,
    });
  }

  // --- everything else: say plainly where it is ----------------------------
  const said = {
    [tags.STAGES.IN_VAN]: 'In our van, on its way to be washed.',
    [tags.STAGES.COLLECTED]: 'Back in our van, on its way to the customer.',
    [tags.STAGES.DONE]: 'Delivered. This tag is finished with.',
  }[stage] || 'Nothing to do with this one right now.';

  return page({
    title: `Bag ${code}`,
    body: header + `
    <div class="card" style="padding:28px;">
      <p style="font-size:16px;line-height:1.6;margin:0;">${escapeHtml(said)}</p>
    </div>` + footer,
  });
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

    // AN ORDER TAG FIRST, A BAG STICKER SECOND.
    //
    // Under the order tag every bag of an order carries the same code, so a
    // scan resolves to the ORDER. Bag stickers from the per-bag model still
    // resolve after it, because stickers already stuck to bags must not stop
    // working the day the model changed.
    const tagged = await tags.findByTag(code);

    if (tagged) {
      await bags.recordScan({ code, orderId: tagged.id, outcome: 'SHOWN', ip, userAgent });
      return res.type('html').send(orderTagPage(tagged, code, req.query.t, req.query));
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

      await bags.recordScan({ code, orderId: order.id, outcome: 'SHOWN', ip, userAgent });

      // WHAT THIS SHOWS DEPENDS ON WHERE THE BAG IS. One sticker, scanned by
      // two different people at four different moments, and each is shown the
      // one thing they can do right now. See bagTagPage().
      // REMEMBER THE LANGUAGE. A laundromat scanning twenty bags should not
      // have to tap the toggle twenty times. Scoped to /o, so it exists only on
      // the one page it means anything on, and it holds nothing but "en" or
      // "es" - no session, no identity, nothing worth stealing.
      const lang = langOf(req);

      if (req.query.lang === 'en' || req.query.lang === 'es') {
        res.cookie('ly_lang', lang, {
          httpOnly: true,
          sameSite: 'lax',
          secure: config.env === 'production',
          path: '/o',
          maxAge: 180 * 24 * 60 * 60 * 1000,
        });
      }

      // WHICH STICKERS ARE DOING WHAT. Only needed while the bag is at a
      // laundromat - every other stage draws no sticker buttons - so it is not
      // fetched for a bag sitting in the van.
      const stage = tags.stageOf(label, order);
      const stickers =
        stage === tags.STAGES.WASHING ? await tags.stickersOn(label).catch(() => []) : [];

      return res
        .type('html')
        .send(bagTagPage(label, order, code, req.query.t, req.query, lang, stickers));
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

    // AN ORDER TAG WEIGHS THE WHOLE LOAD IN ONE NUMBER.
    //
    // Which is what a laundromat actually has: they weigh what goes in the
    // machine, not each bag we carried it in. It goes straight onto the order
    // and settles the price through the same path a per-bag total does, so
    // there is no second implementation of "what does this order cost".
    const tagged = await tags.findByTag(code);

    if (tagged) {
      const weight = Number((req.body || {}).weight_lb);
      const backTo = `/o/${encodeURIComponent(code)}?t=${encodeURIComponent(String(req.query.t || ''))}`;

      if (!Number.isFinite(weight) || weight <= 0 || weight > 400) {
        return res.redirect(303, `${backTo}&weighed=bad`);
      }

      // Same guard as the markup, because the markup guards nothing on a page
      // with no sign-in.
      if (tagged.status !== 'AT_PARTNER') {
        return res.redirect(303, `${backTo}&weighed=early`);
      }

      await db
        .from('orders')
        .update({ partner_weight_lb: weight, partner_weight_at: new Date().toISOString() })
        .eq('id', tagged.id);

      await orderEvents.record(tagged.id, {
        kind: 'PARTNER_WEIGHT',
        summary: `Laundromat weighed the whole load at ${weight.toFixed(1)} lb`,
        was: tagged.weight_lb == null ? null : `${tagged.weight_lb} lb ours`,
        became: `${weight.toFixed(1)} lb theirs`,
        by: { actor: 'partner' },
      });

      const settled = await fulfilment
        .settleWeight({ ...tagged, partner_weight_lb: weight }, { by: { actor: 'partner' } })
        .catch((err) => {
          console.error(`Could not settle order ${tagged.id}: ${err.message}`);
          return { ok: false };
        });

      if (settled && settled.held && tagged.customers) {
        await issues
          .raise({
            customer: tagged.customers,
            order: tagged,
            reason:
              `Scales disagree: we weighed it ${tagged.weight_lb} lb, the laundromat ` +
              `${weight.toFixed(1)} lb. NOTHING HAS BEEN CHARGED and the customer has ` +
              `not been told a price. Settle it on the order page and both happen then.`,
          })
          .catch((err) => console.error(`Could not raise a weight mismatch: ${err.message}`));
      }

      await bags.recordScan({ code, orderId: tagged.id, outcome: 'SHOWN', ip, userAgent });
      return res.redirect(303, `${backTo}&weighed=1`);
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

    // Same guard on the route as on the card. This is the page with no sign-in,
    // so a form that is merely absent from the markup is not a guard at all.
    if ((label.leg || 'PICKUP') === 'DELIVERY') {
      return res.redirect(303, `${back}&weighed=notyours`);
    }

    // NOT UNTIL THE BAG IS ACTUALLY WITH THEM.
    //
    // The form is hidden before hand-over, but a hidden form whose route still
    // fires is not a guard - and this one is on a page with no login at all, so
    // it is the only guard there is.
    if (order.status !== 'AT_PARTNER') {
      return res.redirect(303, `${back}&weighed=early`);
    }

    // First answer wins, PER BAG. Somebody re-scanning a sticker should not be
    // able to quietly revise a figure that has already been counted.
    if (label.partner_weight_lb != null) return res.redirect(303, back);

    await db
      .from('bag_labels')
      .update({ partner_weight_lb: weight, partner_weight_at: new Date().toISOString() })
      .eq('id', label.id);

    // THE COMPARISON IS TOTAL AGAINST TOTAL, and only once every bag is in.
    //
    // orders.partner_weight_lb keeps its meaning - it is what our figure is
    // checked against and what the partner-drift history reads - but it is now
    // the sum of the bags rather than whatever the first person typed. A
    // half-weighed order compared against a full one would flag every
    // laundromat as light.
    // PICKUP BAGS ONLY. These are the bags they were handed; the delivery bags
    // are their own packing and are not theirs to weigh. Counting both sets
    // would also mean the total never completed - a delivery label can never
    // carry a partner weight, so "every bag weighed" would stay false for ever
    // and orders.partner_weight_lb would never be written.
    const allBags = await bags.forOrder(order.id, 'PICKUP');
    const weighedBags = allBags.filter((b) => b.partner_weight_lb != null);

    if (weighedBags.length < allBags.length) {
      await orderEvents.record(order.id, {
        kind: 'PARTNER_WEIGHT',
        summary:
          `Laundromat weighed bag ${label.position} at ${weight} lb ` +
          `(${weighedBags.length} of ${allBags.length})`,
        became: `${weight} lb`,
        by: { actor: 'partner' },
      });
      return res.redirect(303, `${back}&weighed=1`);
    }

    const theirTotal = weighedBags.reduce((t, b) => t + Number(b.partner_weight_lb), 0);

    await db
      .from('orders')
      .update({ partner_weight_lb: theirTotal, partner_weight_at: new Date().toISOString() })
      .eq('id', order.id);

    const weight_ = theirTotal;

    // Two scales are never going to agree exactly. More than a pound apart is
    // worth a person looking at, and it goes on the Issues screen rather than
    // into a log nobody reads - a bad scale in either direction is money.
    const ours = order.weight_lb == null ? null : Number(order.weight_lb);
    const check = partnersCore.compareWeights({ weight_lb: ours, partner_weight_lb: weight_ });

    await orderEvents.record(order.id, {
      kind: 'PARTNER_WEIGHT',
      summary: check
        ? `Laundromat weighed all ${allBags.length} bags at ${weight_.toFixed(1)} lb, ` +
          `${check.absolute.toFixed(1)} lb ${check.heavier ? 'heavier' : 'lighter'} than ours`
        : `Laundromat weighed all ${allBags.length} bags at ${weight_.toFixed(1)} lb`,
      was: ours == null ? null : `${ours} lb`,
      became: `${weight_.toFixed(1)} lb`,
      by: { actor: 'partner' },
      reason: check && check.overThreshold ? 'Outside the tolerance, so an issue was raised' : null,
    });

    // BOTH SCALES ARE NOW IN, SO THE PRICE CAN BE SETTLED.
    //
    // Neil's rule, and settleWeight owns all of it: within tolerance it bills
    // the HIGHER of the two, charges the card and texts the customer the total;
    // past the tolerance it holds everything and waits for him. Doing it here
    // rather than in this route is what stops a second implementation of "what
    // does this order cost" existing on the page with no login.
    const settled = await fulfilment
      .settleWeight({ ...order, partner_weight_lb: weight_ }, { by: { actor: 'partner' } })
      .catch((err) => {
        console.error(`Could not settle order ${order.id}: ${err.message}`);
        return { ok: false };
      });

    if (settled && settled.held && order.customers) {
      await issues
        .raise({
          customer: order.customers,
          order,
          reason:
            `Scales disagree: we weighed it ${ours} lb, the laundromat's ${allBags.length} bags ` +
            `come to ${weight_.toFixed(1)} lb - ` +
            `${check.absolute.toFixed(1)} lb apart, and we allow ${check.tolerance.toFixed(1)}. ` +
            `NOTHING HAS BEEN CHARGED and the customer has not been told a price. ` +
            `Settle it on the order page and both happen then.`,
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

    // An order tag marks the whole order ready, which is the only thing "ready"
    // ever meant - it was never a property of one bag.
    const tagged = await tags.findByTag(code);

    let order = tagged;
    let error = null;

    if (!tagged) {
      const label = await bags.findByCode(code);
      if (!label || !label.order_id || label.released_at) {
        await bags.recordScan({ code, outcome: 'UNBOUND', ip, userAgent });
        return res.status(404).type('html').send(nothingHere());
      }

      ({ data: order, error } = await db
        .from('orders')
        .select('*, customers(id, name, phone, address_line1, city)')
        .eq('id', label.order_id)
        .maybeSingle());
    }

    if (error) throw error;

    if (!order || ['DELIVERED', 'CANCELED'].includes(order.status)) {
      await bags.recordScan({ code, orderId: order && order.id, outcome: 'UNBOUND', ip, userAgent });
      return res.status(404).type('html').send(nothingHere());
    }

    const back = `/o/${encodeURIComponent(code)}?t=${encodeURIComponent(String(req.query.t || ''))}`;

    // WHICH STICKER, AND THEREFORE WHICH FINISHED BAG.
    //
    // All four stickers on a tag print the same bag id, so without the
    // sequence "sub bag 2 is ready" could only be inferred from the order the
    // taps happened to arrive in - and the same sticker tapped twice would be
    // indistinguishable from a second bag. The number makes it a fact.
    //
    // One intake bag becomes any number of finished bags, so this marks ONE
    // of them. The ORDER only becomes ready when every intake bag it holds
    // has at least one finished bag against it.
    // TWO DIFFERENT TAPS ARRIVE HERE, and only one of them finishes the order.
    //
    //   seq=N      advance that sticker: unused -> in use -> done -> unused
    //   order=done the attendant saying the whole order is packed and finished
    //
    // The order used to become READY by inference - the moment every intake bag
    // had one finished bag against it. That assumes one bag in becomes one bag
    // out and then stops watching, and only the person folding knows whether
    // they are still folding. So they say so.
    const body = req.body || {};
    const seq = Number(body.seq);
    const parent = await bags.findByCode(code);

    if (parent && Number.isInteger(seq) && seq >= 1 && seq <= 4) {
      const moved = await tags.cycleSticker(parent, seq);
      if (!moved.ok) return res.redirect(303, back + '&ready=bad');

      const said = { UNUSED: 'is not being used', IN_USE: 'is in use', DONE: 'is finished' }[
        moved.state
      ];

      await orderEvents.record(order.id, {
        kind: 'LABEL',
        summary: `${code}-${seq} ${said}`,
        by: { actor: 'partner' },
      });

      await bags.recordScan({ code, orderId: order.id, outcome: 'SHOWN', ip, userAgent });

      // Back to the same page, which redraws the sticker in its new colour.
      // The order is NOT finished by this tap.
      return res.redirect(303, back);
    }

    // Anything that is not "the order is done" changes nothing else here.
    if (body.order !== 'done') return res.redirect(303, back);

    // NOTHING IS FINISHED WITH NO FINISHED BAG. A stray tap on the button
    // before anything has been packed would send a driver out for nothing.
    const mine = parent ? await tags.stickersOn(parent) : [];
    if (!mine.some((x) => x.state === tags.STICKER.DONE)) {
      return res.redirect(303, back + '&ready=none');
    }

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
