'use strict';

// ---------------------------------------------------------------------------
// THE LAUNDROMAT PROCESSING GUIDE, AS ONE GENERIC PAGE.
//
// Neil's words, 15 September, and the decision lock is deliberately small:
// this is a plain hyperlink from the bag-tag page to one generic page. It is
// not a button, a modal, a workflow step or a confirmation, opening it changes
// no order state, and it needs no second scan and no sign-in.
//
// ONE PAGE FOR EVERY ORDER, WHICH IS THE POINT. The instructions are the same
// for every bag on the shelf, so there is one copy of them and every tag links
// to it. A per-order copy would be the same words rendered eighty times, and
// the eighty-first would be the one somebody edited.
//
// NOTHING PRIVATE IS ON IT, AND THAT IS A CONSTRAINT RATHER THAN A HAPPY
// ACCIDENT. A customer can open their own bag tag and will see the same link,
// so this page is written as though a stranger is reading it: no customer, no
// address, no order, no price, no wholesale rate. It takes no parameters at
// all, which is what makes that true by construction rather than by care.
//
// IT IS THE SAME SHELL AS THE BAG PAGE. Same stylesheets, no navigation, no
// footer, no advertising tag and noindex - all of which the bag page's own
// page() already does. A laundromat attendant is reading this on a phone next
// to a scale; the marketing header inviting them to book a pickup is noise.
//
// EVERY FIGURE COMES FROM THE RUNNING SYSTEM, the same rule /ops/process and
// /ops/journey follow. The sticker count is bags.STICKERS_PER_TAG, which
// CLAUDE.md is explicit about: it went from four to three, and it is a constant
// precisely so that a change reaches the sheet, the roll, the QR page and this
// guide together. The turnaround and both phone numbers are read the same way.
// ---------------------------------------------------------------------------

const bags = require('../core/bags');
const format = require('../core/format');
const { config } = require('../config');
const { site } = require('./site');

// Written out, because "3 detachable stickers" reads as a form and a person
// reading a wall of instructions is reading prose. Falls back to the numeral
// for any count nobody has a word for.
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const inWords = (n) => WORDS[n] || String(n);

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A numbered step. One shape for all eleven, so they cannot drift apart.
function step(number, heading, body) {
  return `
  <section class="card" style="padding:24px;margin-bottom:16px;">
    <p class="eyebrow" style="margin:0 0 8px;">Step ${number}</p>
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:22px;line-height:1.2;margin:0 0 12px;">
      ${esc(heading)}
    </h2>
    ${body}
  </section>`;
}

// The boxes that say "this one matters". Sunbeam for a warning somebody has to
// read, stain for the one thing that must never happen.
function callout(words, tone = 'sunbeam') {
  const background = tone === 'stain' ? 'var(--stain-100)' : 'var(--sunbeam-100)';
  const edge = tone === 'stain' ? 'var(--stain-500)' : 'var(--sunbeam-500)';

  return `
  <p style="margin:14px 0 0;padding:12px 15px;border:2px solid ${edge};border-radius:10px;
            background:${background};font-size:15px;line-height:1.55;font-weight:600;">
    ${words}
  </p>`;
}

const list = (items) =>
  `<ul style="margin:10px 0 0;padding-left:20px;font-size:16px;line-height:1.65;color:var(--ink-800);">
    ${items.map((i) => `<li style="margin-bottom:5px;">${i}</li>`).join('')}
  </ul>`;

const para = (words) =>
  `<p style="margin:0 0 10px;font-size:16px;line-height:1.65;color:var(--ink-800);">${words}</p>`;

// A tick list somebody reads before tapping something.
const checks = (items) =>
  `<ul style="margin:10px 0 0;padding-left:0;list-style:none;font-size:16px;line-height:1.7;color:var(--ink-800);">
    ${items
      .map(
        (i) =>
          `<li style="margin-bottom:5px;display:flex;gap:9px;"><span aria-hidden="true">&check;</span><span>${i}</span></li>`
      )
      .join('')}
  </ul>`;

function processingGuideBody() {
  const stickers = bags.STICKERS_PER_TAG;
  const stickerWord = inWords(stickers);

  // The escalation number, and ONLY IF ONE IS SET. See the note in the route.
  //
  // FORMATTED, because it is read aloud off a screen by somebody holding a bag.
  // It is stored as E.164 like every other number here; the display lock is
  // XXX-XXX-XXXX and this page is no exception.
  const ownerCell = config.supportPhone ? format.displayPhone(config.supportPhone) : '';

  // An example set of sticker ids, built from the real count so it cannot show
  // three when a tag carries four. The code itself is plainly an example.
  const exampleCodes = Array.from({ length: stickers }, (_, i) => `FA5PP1-${i + 1}`);

  return `
  <div class="card" style="padding:28px;margin-bottom:22px;">
    <p class="eyebrow" style="margin:0 0 8px;">For the laundromat</p>
    <h1 style="font-family:var(--font-display);font-weight:900;font-size:clamp(26px,6vw,34px);line-height:1.1;margin:0 0 14px;">
      Processing guide
    </h1>
    ${para('Please follow these steps for every LYNDRY order.')}
    ${para(
      `The LYNDRY bag tag and stickers keep each order identifiable from the time it arrives here until LYNDRY collects the finished laundry.`
    )}
    ${para(
      `LYNDRY guarantees ${esc(site.turnaround)} delivery, so orders must be completed promptly and marked ready as soon as processing is finished.`
    )}
  </div>

  <section class="card" style="padding:24px;margin-bottom:16px;">
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:22px;line-height:1.2;margin:0 0 12px;">
      About the bag tag
    </h2>
    ${para('Every incoming laundry bag has a LYNDRY bag tag attached. Each tag has:')}
    ${list([
      'A QR code that opens the order',
      `${esc(stickerWord.charAt(0).toUpperCase() + stickerWord.slice(1))} detachable stickers`,
      'Each detachable sticker has its own QR code and sticker number',
    ])}
    ${para('')}
    ${para('The bag tag identifies the <strong>order</strong>, not the customer.')}
    ${para(
      'The tag must stay with the laundry throughout processing. The detachable stickers keep separated portions identifiable, and identify the finished bags LYNDRY collects.'
    )}
    ${callout('Do not throw away the bag tag or any unused stickers.')}
  </section>

  ${step(
    1,
    'Scan the QR code',
    `${para('Before processing the laundry:')}
     ${list([
       'Scan any QR code on the bag tag.',
       'Wait for the order page to finish loading.',
       'Check that the code on the screen matches the code on the tag.',
     ])}
     ${callout('Do not begin processing until the correct order page has loaded.')}
     ${para('')}
     ${para(
       'If the screen says <strong>that bag is not with you yet</strong>, do not start the order. It has not been released for processing.'
     )}`
  )}

  ${step(
    2,
    'Weigh the incoming laundry',
    `${para('Before washing:')}
     ${list([
       'Weigh the incoming laundry on your scale.',
       'Enter the weight on the order page.',
       'Tap Save.',
     ])}
     ${callout(
       'The wash instructions only appear after the weight has been saved. Do not begin washing before the incoming weight is entered and saved.'
     )}`
  )}

  ${step(
    3,
    'Read the wash instructions',
    `${para(
      'Once the weight is saved, the wash instructions for that order appear on the phone. Read them before starting the wash, including any:'
    )}
     ${list(['Water temperature', 'Detergent', 'Softener', 'Fragrance preference'])}
     ${callout(
       'Always follow the instructions on the phone. Never assume two LYNDRY orders have the same wash preferences.'
     )}`
  )}

  ${step(
    4,
    'Keep the tag with the order',
    `${para('The bag tag stays with the laundry the whole way through:')}
     ${para(
       '<strong>Wash &rarr; Dry &rarr; Fold &rarr; Pack</strong>'
     )}
     ${para(
       'If the laundry moves between washers, dryers, carts, folding tables or work areas, the LYNDRY identification has to move with it.'
     )}
     ${callout('Never mix two LYNDRY orders together. Do not throw away the bag tag.', 'stain')}`
  )}

  ${step(
    5,
    'If the laundry is split, use the stickers',
    `${para(
      'Sometimes one order needs separating across several washers, dryers, carts or work areas. That is fine.'
    )}
     ${para(
       `Each bag tag has ${esc(stickerWord)} detachable QR stickers for exactly this. If part of the order is separated:`
     )}
     ${list([
       'Take one detachable sticker off the tag.',
       "Attach it to your own tracking tag, receipt or identifier for that portion.",
       'Keep it with that portion while it moves through processing.',
     ])}
     ${callout('Every part of the order must stay identifiable.')}`
  )}

  ${step(
    6,
    'Wash, dry and fold',
    `${para(
      'Complete the normal wash-and-fold process, following the instructions shown on the order page. Before packing, check:'
    )}
     ${checks([
       'Washing is complete',
       'Drying is complete',
       'Folding is complete',
       'Every portion of the order is accounted for',
       'No laundry from another LYNDRY order has been mixed in',
     ])}`
  )}

  ${step(
    7,
    'Pack the finished laundry',
    `${para(
      'Pack the clean laundry into finished bags. The number of finished bags does not have to match the number that arrived: one bag in can be two or three bags out.'
    )}
     ${para(
       'If the laundry arrived in a disposable bag - plastic, paper or a trash bag - pack the clean laundry into a LYNDRY bag if you have one, or a clean white laundry bag.'
     )}
     ${callout(
       'Never pack clean laundry back into the disposable bag it arrived in.',
       'stain'
     )}`
  )}

  ${step(
    8,
    'Put a sticker on every finished bag',
    `${para(
      'Every finished bag needs one LYNDRY sticker. One finished bag is one sticker, two bags is two stickers, and so on.'
    )}
     ${para('The sticker tells LYNDRY which order that bag belongs to. Do not:')}
     ${list([
       'Leave a finished bag without a sticker',
       'Mix two LYNDRY orders in one finished bag',
       'Throw away unused stickers',
       'Assume the driver will know which bags belong together',
     ])}`
  )}

  ${step(
    9,
    'Select only the stickers you used',
    `${para(
      'Go back to the order page. It lists the sticker numbers on that tag, for example:'
    )}
     ${para(
       `<span class="mono" style="font-family:var(--font-mono);">${exampleCodes.map(esc).join('<br>')}</span>`
     )}
     ${para('Tap only the sticker numbers actually attached to finished bags.')}
     ${callout(
       'The number of stickers you select tells the driver how many finished bags to collect. Tapped one by mistake? Tap it again to turn it off.'
     )}
     ${para('')}
     ${checks([
       'Every finished bag has a sticker',
       'Every sticker on a finished bag is selected on the phone',
       'No unused sticker is selected',
       'Stickers selected = finished bags',
     ])}`
  )}

  ${step(
    10,
    'Tap ready for collection',
    `${para('Only once all of this is true:')}
     ${checks([
       'Washing, drying and folding are complete',
       'Every part of the order is accounted for',
       'The laundry is packed correctly',
       'Every finished bag has a sticker',
       'Only the stickers actually used are selected',
     ])}
     ${para('')}
     ${para(
       'The phone will say <strong>thanks, we are on our way</strong>. That means LYNDRY knows the order is finished and ready to collect.'
     )}`
  )}

  ${step(
    11,
    'Put the order in the pickup area',
    `${list([
       'Keep all the finished bags for one order together.',
       'Put them in the LYNDRY pickup area or shelf.',
       'Make sure every bag has its sticker clearly attached.',
     ])}
     ${para('')}
     ${para(
       'The driver uses the stickers selected in the system to know how many bags should be waiting. Two stickers selected means two finished bags waiting.'
     )}`
  )}

  <section class="card" style="padding:24px;margin-bottom:16px;">
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:22px;line-height:1.2;margin:0 0 12px;">
      If something is wrong
    </h2>
    ${para(
      'If the QR code will not open the order, the page is blank, the tag appears dead, or the order information is missing, do not guess and do not begin processing.'
    )}
    ${para(`Call LYNDRY on <strong>${esc(site.callPhoneDisplay)}</strong>.`)}
    ${
      ownerCell
        ? para(
            `If nobody answers and it is stopping an order being processed correctly, call <strong>${esc(
              ownerCell
            )}</strong>.`
          )
        : ''
    }
  </section>

  <section class="card" style="padding:24px;margin-bottom:16px;">
    <h2 style="font-family:var(--font-display);font-weight:800;font-size:22px;line-height:1.2;margin:0 0 12px;">
      Four rules to remember
    </h2>
    ${list([
      'Never mix LYNDRY orders.',
      'Never send out a finished bag without a sticker.',
      'Never put clean laundry back into the disposable bag it arrived in.',
      'Stickers selected must equal finished bags.',
    ])}
    ${callout(
      `LYNDRY guarantees ${esc(
        site.turnaround
      )} delivery. Mark each order ready for collection as soon as it is finished, packed and labelled.`
    )}
  </section>`;
}

module.exports = { processingGuideBody };
