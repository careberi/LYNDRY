'use strict';

const QRCode = require('qrcode');

const bags = require('../core/bags');
const { site } = require('./site');

// ---------------------------------------------------------------------------
// The sticker sheet.
//
// Laid out for AVERY 5160 - the 1 inch by 2 5/8 inch address label, 30 to a
// sheet, three across and ten down. It is the cheapest and most widely stocked
// label in America, which is the entire reason for choosing it: nothing has to
// be ordered specially and a box costs about ten dollars in any office shop.
// The same geometry is sold as Avery 8160, 5960, 8460 and a dozen own-brand
// equivalents, so almost any "30 per sheet address label" will line up.
//
// Every measurement below is in inches on purpose. A sticker sheet is a
// physical object and the numbers come off the packet; converting them to
// pixels would only introduce a rounding error between the screen and the
// paper.
// ---------------------------------------------------------------------------

const SHEET = Object.freeze({
  perSheet: 30,
  columns: 3,
  labelWidth: '2.625in',
  labelHeight: '1in',
  columnGap: '0.125in',
  marginTop: '0.5in',
  marginLeft: '0.1875in',
});

// One QR per code. Drawn as SVG so it stays sharp at any printer resolution -
// a raster QR at 1 inch is exactly the thing that will not scan.
async function qrFor(code) {
  try {
    return await QRCode.toString(bags.labelUrl(code), {
      type: 'svg',
      margin: 0,
      // High correction, because this is going on a laundry bag. It will get
      // creased, damp and rubbed, and H survives roughly a third of the code
      // being unreadable. A six-character URL is small enough that the extra
      // redundancy costs nothing in printed size.
      errorCorrectionLevel: 'H',
      color: { dark: '#101210', light: '#ffffff' },
    });
  } catch (err) {
    console.error(`Could not draw a QR for ${code}: ${err.message}`);
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

// The sheet itself, ready to print. `labels` are rows from bag_labels.
async function labelSheetBody(labels) {
  const drawn = await Promise.all(
    labels.map(async (l) => ({ code: l.code, qr: await qrFor(l.code) }))
  );

  const stickers = drawn
    .map(
      (l) => `
    <div class="lb-sticker">
      <div class="lb-qr">${l.qr}</div>
      <div class="lb-text">
        <div class="lb-brand">${esc(site.name)}</div>
        <div class="lb-code">${esc(l.code)}</div>
        <div class="lb-hint">Scan me</div>
      </div>
    </div>`
    )
    .join('');

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
    grid-template-columns: repeat(${SHEET.columns}, ${SHEET.labelWidth});
    column-gap: ${SHEET.columnGap};
    row-gap: 0;
  }

  .lb-sticker {
    width: ${SHEET.labelWidth};
    height: ${SHEET.labelHeight};
    display: flex;
    align-items: center;
    gap: 0.1in;
    padding: 0.06in 0.1in;
    /* Deliberately no border: the sticker's own edge is the border, and a
       printed rule that misses the die-cut by a millimetre looks like a fault.
       The dashed guide below only exists on screen. */
    overflow: hidden;
  }

  .lb-sticker .lb-qr { width: 0.82in; height: 0.82in; flex: none; }
  .lb-sticker .lb-qr svg { display: block; width: 100%; height: 100%; }

  .lb-text { min-width: 0; }
  .lb-brand {
    font-family: var(--font-mono); font-size: 7pt; font-weight: 700;
    letter-spacing: 0.14em; text-transform: uppercase; color: #101210;
  }
  /* THE CODE IS THE FALLBACK, so it is set big enough to read at arm's length
     in a badly lit basement when the camera will not focus. */
  .lb-code {
    font-family: var(--font-mono); font-size: 19pt; font-weight: 700;
    letter-spacing: 0.06em; color: #101210; line-height: 1.05; margin: 0.01in 0;
  }
  .lb-hint { font-family: var(--font-mono); font-size: 6.5pt; color: #5B635B; letter-spacing: 0.08em; }

  /* On screen only, so you can see where the die cuts fall before wasting a
     sheet of labels. */
  @media screen {
    .lb-sticker { outline: 1px dashed #C4CBC2; outline-offset: -1px; }
  }

  /* ---- on paper ---- */
  @media print {
    /* Everything that is not the sheet. The ops furniture must not print. */
    .site-header, .ops-bar, .lb-actions, .lb-noprint { display: none !important; }
    main.container { padding: 0 !important; max-width: none !important; }
    body { background: #fff !important; }

    @page { size: letter; margin: 0; }

    .lb-sheet {
      border: 0; border-radius: 0; box-shadow: none; padding: ${SHEET.marginTop} 0 0 ${SHEET.marginLeft};
      width: 8.5in; max-width: none; overflow: visible;
    }
    .lb-grid { page-break-inside: auto; }
    .lb-sticker { break-inside: avoid; page-break-inside: avoid; }
  }
</style>

<div class="lb-noprint" style="max-width:640px;">
  <p class="eyebrow" style="margin:0 0 8px;">Stickers</p>
  <h1 style="margin:0 0 14px;font-size:40px;line-height:1.05;">${labels.length} bag ${
    labels.length === 1 ? 'label' : 'labels'
  }</h1>
  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);">
    Print these on Avery 5160 labels - the standard 30-per-sheet address label,
    about ten dollars a box anywhere. Set the printer to <strong>100% scale, not
    "fit to page"</strong>, or nothing will line up. Keep the roll in the van;
    a sticker means nothing until a driver scans it onto a bag.
  </p>
</div>

<div class="lb-actions">
  <button type="button" class="btn" onclick="window.print()">Print this sheet</button>
  <a class="btn btn-outline" href="/ops/labels">Back to labels</a>
</div>

<div class="lb-sheet">
  <div class="lb-grid">${stickers}</div>
</div>`;
}

module.exports = { labelSheetBody, SHEET };
