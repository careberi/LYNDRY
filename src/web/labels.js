'use strict';

const QRCode = require('qrcode');

const bags = require('../core/bags');
const { site } = require('./site');

// ---------------------------------------------------------------------------
// THE BAG TAG SHEET.
//
// What gets printed is no longer a sticker. It is a BAG TAG: one tag id, and
// four numbered peelable stickers carrying that same id. The tag goes on the
// bag we collect; the stickers come off it one at a time and go on whatever
// bags the laundromat packs the clean laundry into.
//
// THE SEQUENCE IS WHY THERE ARE FOUR RATHER THAN ONE REPEATED FOUR TIMES.
// All four say 7MQ5Y2, which is what a person says out loud, and each also
// says -1 through -4, which is what makes them individually addressable. Four
// identical stickers cannot tell a repeat scan from a second bag.
//
// --- The paper ------------------------------------------------------------
//
// Laid out for AVERY 5164 - the 3 1/3 inch by 4 inch shipping label, six to a
// sheet, two across and three down. It replaced the 5160 address label that
// carried the old one-code-per-bag sticker, for the obvious reason: five QR
// codes and five printed ids do not go on a label the size of a business card.
//
// 5164 is still ordinary stock. The same geometry is sold as 8164, 5264 and
// most own-brand "6 per sheet shipping labels", so it does not have to be
// ordered specially.
//
// THE STICKERS ARE CUT, NOT DIE-CUT, and that is a deliberate compromise
// rather than an oversight. Nothing off a shelf comes with four peelable
// squares inside one label, so the four are printed with dashed lines between
// them and somebody at the counter runs a pair of scissors down them - each
// piece keeps its own adhesive and peels off its own backing exactly as if it
// had been die-cut. If tags are ever ordered properly printed, the artwork is
// already the right shape and this file does not change.
//
// Every measurement is in inches on purpose. A sticker sheet is a physical
// object and the numbers come off the packet; converting them to pixels would
// only introduce a rounding error between the screen and the paper.
// ---------------------------------------------------------------------------

const SHEET = Object.freeze({
  stock: 'Avery 5164',
  perSheet: 6,
  columns: 2,
  tagWidth: '3.33in',
  tagHeight: '4in',
  columnGap: '0.19in',
  marginTop: '0.5in',
  marginLeft: '0.16in',
});

// How many peelable stickers are on one tag. Four is the number the database
// enforces too - bag_labels.sticker_seq is checked between 1 and 4 - so this
// is not a display choice that can drift on its own.
const STICKERS = [1, 2, 3, 4];

// One QR. Drawn as SVG so it stays sharp at any printer resolution - a raster
// QR at this size is exactly the thing that will not scan.
async function qrFor(code, seq) {
  try {
    return await QRCode.toString(bags.labelUrl(code, seq), {
      type: 'svg',
      margin: 0,
      // High correction, because this is going on a laundry bag. It will get
      // creased, damp and rubbed, and H survives roughly a third of the code
      // being unreadable.
      errorCorrectionLevel: 'H',
      color: { dark: '#101210', light: '#ffffff' },
    });
  } catch (err) {
    console.error(`Could not draw a QR for ${code}${seq ? `-${seq}` : ''}: ${err.message}`);
    return '';
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// One tag: the header that stays on the bag we collect, and the four stickers
// that come off it.
function tagMarkup({ code, tagQr, stickerQrs }) {
  // ID ACROSS THE TOP, QR CENTRED UNDERNEATH. Neil's layout.
  //
  // It reads better than the side-by-side arrangement it replaces for the
  // reason a sticker is looked at in the first place: the id is what somebody
  // reads out, so it wants the full width rather than a column beside a square.
  // The QR then sits centred below it and can be as large as the sticker
  // allows, which is what decides whether a camera locks on.
  //
  // The sequence rides on the id - L4XK92-2, one line - rather than sitting off
  // to the side. It is part of what a person says out loud, not a footnote.
  const stickers = STICKERS.map(
    (n, i) => `
      <div class="lb-sticker">
        <div class="lb-scode">${esc(code)}-${n}</div>
        <div class="lb-sq">${stickerQrs[i]}</div>
      </div>`
  ).join('');

  return `
    <div class="lb-tag">
      <div class="lb-head">
        <div class="lb-brand">${esc(site.name)} bag tag &middot; stays on this bag</div>
        <div class="lb-code">${esc(code)}</div>
        <div class="lb-hq">${tagQr}</div>
      </div>
      <div class="lb-peel">${stickers}</div>
    </div>`;
}

// The sheet itself, ready to print. `labels` are rows from bag_labels.
async function labelSheetBody(labels) {
  const drawn = await Promise.all(
    labels.map(async (l) => ({
      code: l.code,
      tagQr: await qrFor(l.code, null),
      stickerQrs: await Promise.all(STICKERS.map((n) => qrFor(l.code, n))),
    }))
  );

  const tags = drawn.map(tagMarkup).join('');

  return `
<style>
  /* ---- on screen ---- */
  .lb-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 26px; }

  .lb-sheet {
    background: #fff;
    border: 2px solid var(--ink-900);
    border-radius: 12px;
    box-shadow: var(--shadow-pop-sm);
    padding: ${SHEET.marginTop} 0 ${SHEET.marginTop} ${SHEET.marginLeft};
    width: 8.5in;
    max-width: 100%;
    overflow-x: auto;
  }

  .lb-grid {
    display: grid;
    grid-template-columns: repeat(${SHEET.columns}, ${SHEET.tagWidth});
    column-gap: ${SHEET.columnGap};
    row-gap: 0;
  }

  .lb-tag {
    width: ${SHEET.tagWidth};
    height: ${SHEET.tagHeight};
    display: flex;
    flex-direction: column;
    padding: 0.12in;
    /* Deliberately no border on the tag: the label's own die-cut edge is the
       border, and a printed rule that misses it by a millimetre reads as a
       fault. The dashed guide below only exists on screen. */
    overflow: hidden;
    color: #101210;
  }

  /* --- the header, which stays on the bag we collect ---
     Stacked, like the stickers below it: brand, then the id across the full
     width, then the QR centred under it. */
  .lb-head {
    display: flex; flex-direction: column; align-items: center;
    height: 1.72in; flex: none; text-align: center;
  }
  .lb-hq { width: 0.86in; height: 0.86in; flex: none; margin-top: 0.03in; }
  .lb-hq svg { display: block; width: 100%; height: 100%; }

  .lb-brand {
    font-family: var(--font-mono); font-size: 7pt; font-weight: 700;
    letter-spacing: 0.13em; text-transform: uppercase;
  }
  /* THE ID IS THE FALLBACK, so it is set big enough to read at arm's length in
     a badly lit basement when the camera will not focus. */
  .lb-code {
    font-family: var(--font-mono); font-size: 30pt; font-weight: 700;
    letter-spacing: 0.05em; line-height: 1.02; margin: 0.02in 0 0.04in;
  }

  /* --- the four peelable stickers --- */
  .lb-peel {
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    /* The cut lines. A dashed rule is the instruction: this is where the
       scissors go, and each piece peels off its own backing afterwards. */
    border-top: 1px dashed #101210;
    margin-top: 0.06in;
  }

  .lb-sticker {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 0.03in;
    padding: 0.05in 0.03in;
    min-width: 0;
    text-align: center;
    border-right: 1px dashed #101210;
    border-bottom: 1px dashed #101210;
  }
  /* The outer edges are the label's own edge, not a cut. */
  .lb-sticker:nth-child(2n) { border-right: 0; }
  .lb-sticker:nth-child(n + 3) { border-bottom: 0; }

  .lb-sq { width: 0.72in; height: 0.72in; flex: none; }
  .lb-sq svg { display: block; width: 100%; height: 100%; }

  /* THE ID GETS THE FULL WIDTH, which is the whole point of stacking. It is
     what somebody reads out when the camera will not focus, so it is set as
     large as the sticker allows rather than squeezed beside a square. */
  .lb-scode {
    font-family: var(--font-mono); font-size: 13pt; font-weight: 700;
    letter-spacing: 0.03em; line-height: 1.05; white-space: nowrap;
  }

  /* On screen only, so you can see where the die cuts fall before wasting a
     sheet of labels. */
  @media screen {
    .lb-tag { outline: 1px dashed #C4CBC2; outline-offset: -1px; }
  }

  /* ---- on paper ---- */
  @media print {
    /* Everything that is not the sheet. The ops furniture must not print. */
    .site-header, .ops-bar, .lb-actions, .lb-noprint { display: none !important; }
    main.container { padding: 0 !important; max-width: none !important; }
    body { background: #fff !important; }

    @page { size: letter; margin: 0; }

    .lb-sheet {
      border: 0; border-radius: 0; box-shadow: none;
      padding: ${SHEET.marginTop} 0 0 ${SHEET.marginLeft};
      width: 8.5in; max-width: none; overflow: visible;
    }
    .lb-grid { page-break-inside: auto; }
    .lb-tag { break-inside: avoid; page-break-inside: avoid; }
  }
</style>

<div class="lb-noprint" style="max-width:660px;">
  <p class="eyebrow" style="margin:0 0 8px;">Bag tags</p>
  <h1 style="margin:0 0 14px;font-size:40px;line-height:1.05;">${labels.length} bag ${
    labels.length === 1 ? 'tag' : 'tags'
  }</h1>
  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);">
    Print these on <strong>${esc(SHEET.stock)}</strong> labels - the 6 per sheet
    shipping label, sold everywhere. Set the printer to
    <strong>100% scale, not "fit to page"</strong>, or nothing will line up.
  </p>
  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);">
    Each tag has one id and <strong>four numbered stickers</strong> under it.
    The tag stays on the bag we collect. The laundromat cuts the stickers apart
    along the dashed lines and puts one on each bag it packs - however many that
    turns out to be. All four say the same id, so it is still one order.
  </p>
</div>

<div class="lb-actions">
  <button type="button" class="btn" onclick="window.print()">Print this sheet</button>
  <a class="btn btn-outline" href="/ops/labels">Back to bag tags</a>
</div>

<div class="lb-sheet">
  <div class="lb-grid">${tags}</div>
</div>`;
}

// A small QR for the bag tags LIST, not the printed sheet.
//
// Same URL as the tag itself, so pointing a phone at the screen goes exactly
// where pointing it at the printed tag would. Medium correction rather than
// high: this one is on a monitor, not creased and damp on a laundry bag, so
// the extra redundancy would only cost pixels at 58px square.
async function labelListQr(code) {
  try {
    return await QRCode.toString(bags.labelUrl(code), {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#101210', light: '#00000000' },
    });
  } catch (err) {
    console.error(`Could not draw a list QR for ${code}: ${err.message}`);
    return '';
  }
}

// ---------------------------------------------------------------------------
// ONE BAG TAG, IN FULL.
//
// What you get by tapping an id on the list: the tag drawn the way it prints,
// a QR big enough to scan off the screen from across a room, the URL under it,
// and which order it is on.
//
// THE QR IS DELIBERATELY LARGE. The one on the list is 58px, which is a
// thumbnail - enough to tell one row from another and not enough to point a
// phone at from arm's length. This is the page you open when you actually want
// to scan the thing, so it is sized for that.
// ---------------------------------------------------------------------------

async function labelDetailBody(label, { order = null, state, scans = [] }) {
  const tagQr = await qrFor(label.code, null);
  const stickerQrs = await Promise.all(STICKERS.map((n) => qrFor(label.code, n)));

  const url = bags.labelUrl(label.code);
  const dead = state === 'EXPIRED';

  const sticker = (n, i) => `
    <div style="padding:14px 10px;border:2px solid var(--ink-900);border-radius:12px;
                background:var(--paper-050);text-align:center;">
      <div style="font-family:var(--font-mono);font-weight:700;font-size:14px;margin-bottom:8px;">
        ${esc(label.code)}-${n}
      </div>
      <div style="width:100%;max-width:120px;margin:0 auto;">${stickerQrs[i]}</div>
    </div>`;

  return `
<a href="/ops/labels" style="font-size:15px;font-weight:600;">&larr; All bag tags</a>

<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:14px;margin:18px 0 8px;">
  <h1 style="font-family:var(--font-mono);font-weight:700;font-size:44px;letter-spacing:0.06em;margin:0;">
    ${esc(label.code)}
  </h1>
  <span class="badge" style="background:${
    state === 'IN_USE' ? 'var(--suds-500)' : state === 'EXPIRED' ? 'var(--paper-300)' : 'var(--lilac-500)'
  };">${esc(state === 'IN_USE' ? 'In use' : state === 'EXPIRED' ? 'Expired' : 'Outstanding')}</span>
  ${
    order
      ? `<a href="/ops/orders/${esc(String(order.order_number))}" style="font-weight:700;font-size:17px;">
           Order #${esc(String(order.order_number))}
         </a>`
      : '<span style="font-size:16px;color:var(--ink-500);">Not on a bag yet</span>'
  }
</div>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-top:26px;">

  <div class="card card-xl" style="padding:26px;text-align:center;">
    <p class="eyebrow" style="margin:0 0 14px;">The tag itself</p>
    <div style="width:100%;max-width:260px;margin:0 auto;${dead ? 'opacity:0.3;' : ''}">
      ${tagQr}
    </div>
    <p style="font-family:var(--font-mono);font-size:12px;line-height:1.5;margin:16px 0 0;
              overflow-wrap:anywhere;">
      ${
        dead
          ? `<s>${esc(url)}</s><br><span style="color:var(--stain-500);font-weight:700;">
               dead - the order was delivered
             </span>`
          : `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`
      }
    </p>
  </div>

  <div class="card card-xl" style="padding:26px;">
    <p class="eyebrow" style="margin:0 0 6px;">The four peelable stickers</p>
    <p style="font-size:14px;line-height:1.55;color:var(--ink-700);margin:0 0 16px;">
      All say ${esc(label.code)}. The number is what makes them individually
      addressable, so a sticker tapped twice is not mistaken for a second bag.
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;${dead ? 'opacity:0.3;' : ''}">
      ${STICKERS.map(sticker).join('')}
    </div>
  </div>
</div>

${
  scans.length
    ? `
<div class="card card-xl" style="padding:26px;margin-top:20px;">
  <p class="eyebrow" style="margin:0 0 14px;">Every time somebody pointed a camera at it</p>
  ${scans
    .map(
      (sc) => `
    <div style="display:flex;flex-wrap:wrap;gap:10px 18px;padding:10px 0;
                border-bottom:1px solid var(--ink-100);font-size:14px;">
      <span style="font-variant-numeric:tabular-nums;color:var(--ink-500);min-width:150px;">
        ${esc(String(sc.created_at).slice(0, 16).replace('T', ' '))}
      </span>
      <span style="font-weight:600;">${esc(sc.outcome || '')}</span>
    </div>`
    )
    .join('')}
</div>`
    : ''
}

<div class="lb-actions" style="margin-top:24px;">
  <a class="btn" href="/ops/labels/sheet?n=1&only=${encodeURIComponent(label.code)}">Print this one</a>
</div>`;
}

module.exports = { labelSheetBody, labelListQr, labelDetailBody, SHEET, STICKERS };
