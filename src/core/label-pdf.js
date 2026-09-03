'use strict';

const QRCode = require('qrcode');
const bags = require('./bags');
const { site } = require('../web/site');

// ---------------------------------------------------------------------------
// LABELS AS A PDF, FOR A THERMAL ROLL PRINTER.
//
// Neil prints on a Clabel CT221D loaded with 2 x 1 inch labels, through its
// "PDF Print" mode - which says plainly: there can only be one tag on a single
// PDF page. So this is one label per page, at the exact page size of the label,
// and the printer does no scaling.
//
// A ROLL CHANGES THE TAG. The sheet version is a hang tag with peelable
// stickers and dashed lines to cut down. On a roll every label is ALREADY
// separate and already self-adhesive, so the cutting was solving a problem the
// paper does not have - and the tag itself stopped being a separate object, so
// there is no tag label either. One bag is three labels off the roll: -1, -2
// and -3, all carrying the same id.
//
// WRITTEN BY HAND RATHER THAN WITH A PDF LIBRARY, and that is a deliberate
// trade. Everything on a label is a filled rectangle or a line of text in a
// built-in font: the QR is drawn as vector squares from the module matrix, not
// embedded as an image, so there is nothing to compress and no font to embed.
// That is a couple of hundred lines here against a dependency in a codebase
// whose whole posture is a short package.json. It also prints sharper - a
// vector QR has no resolution to be wrong at.
// ---------------------------------------------------------------------------

// PDF works in points. 72 of them to an inch, always.
const PT = 72;

// THE PRINTER'S DOTS PER INCH, AND WHY THIS FILE KNOWS IT.
//
// A thermal head prints dots, not curves. If a QR module works out at 3.9 dots
// across, every module lands on a different fraction of a dot and the head
// rounds each one differently - so edges wander by a dot, black modules bleed
// into white ones, and the whole code goes mushy. Neil saw it and said so:
// "the quality deteriorates... is there any way the QR could be bigger or not
// as fine."
//
// The fix is to make a module a WHOLE number of dots. Then every edge falls on
// a dot boundary and the head has nothing to round.
//
// 203 is the CT221D and is what nearly every 2-inch thermal label printer runs
// at. Overridable, because a 300 dpi one would want a different whole number.
const DEFAULT_DPI = 203;

// The label on the roll. Overridable, because the next roll may not be this
// size and a wrong guess wastes a whole one.
const DEFAULT_LABEL = Object.freeze({ widthIn: 2, heightIn: 1 });

// PDF text has to be escaped: backslash, and both kinds of bracket, are
// structure. Everything we print is A-Z, 0-9 and a hyphen, so this is a guard
// against a future caller rather than today's data.
function pdfText(s) {
  return String(s == null ? '' : s).replace(/[\\()]/g, (c) => `\\${c}`);
}

// A number, as PDF wants it: no exponent, no more precision than a printer can
// resolve.
function n(v) {
  return Number(v).toFixed(2).replace(/\.00$/, '');
}

// ---------------------------------------------------------------------------
// One label's content stream.
//
// The layout is the same argument as the sheet's: the QR is the shortcut and
// the ID IS THE FALLBACK, so the id is set as large as the label allows. A
// camera that will not focus in a badly lit basement is the normal case, not
// the edge one.
// ---------------------------------------------------------------------------
function labelStream({ code, seq, matrix, size }, label, dpi) {
  // THE PAGE SIZE THAT WAS ASKED FOR, not the default. Laying the content out
  // for 2 x 1 and then declaring a 4 x 6 page would put a correct-looking label
  // in the corner of a mostly empty one, and a thermal printer would feed six
  // inches of blank stock for every tag.
  const W = label.widthIn * PT;
  const H = label.heightIn * PT;

  const pad = 3;

  // QR needs a quiet zone. The conventional four modules is a lot on a label
  // this small - the label's own white border does the same job - so two is
  // enough and buys roughly 15% more module size, which is what decides
  // whether a phone locks on.
  const quiet = 2;
  const cells = size + quiet * 2;

  // A MODULE IS A WHOLE NUMBER OF PRINTER DOTS, and this is the line that
  // fixed the mush. The biggest whole dot count that still fits the label.
  const dotPt = PT / dpi;
  const dotsPerCell = Math.max(1, Math.floor((H - pad * 2) / cells / dotPt));
  const cell = dotsPerCell * dotPt;
  const qrBox = cell * cells;

  // Centred vertically in whatever is left, and snapped to the dot grid too -
  // starting half a dot in would put every module back across a boundary and
  // undo the whole exercise.
  const qrX = Math.round(pad / dotPt) * dotPt;
  const qrY = Math.round((H - qrBox) / 2 / dotPt) * dotPt;

  const parts = [];
  parts.push('0 0 0 rg');

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!matrix[row * size + col]) continue;
      const x = qrX + (col + quiet) * cell;
      // PDF's origin is bottom-left and a QR matrix reads top-down, so the row
      // is flipped. Getting this wrong produces a QR that looks right and
      // scans as a different code.
      const y = qrY + qrBox - (row + quiet + 1) * cell;
      // Exactly one cell. The old version drew a third of a point oversize to
      // stop hairlines between modules - which was papering over the real
      // problem, and on a dot grid it would push every module a fraction into
      // its neighbour, which is the same mush by a different route.
      parts.push(`${n(x)} ${n(y)} ${n(cell)} ${n(cell)} re`);
    }
  }
  parts.push('f');

  const textX = qrX + qrBox + 7;
  const textW = W - textX - pad;

  // The id, as big as the space allows. Courier-Bold because it is a built-in
  // font, monospaced - so a column of labels lines up - and unambiguous in the
  // characters this alphabet uses.
  const printedId = seq ? `${code}-${seq}` : code;
  const idSize = Math.min(13, (textW / printedId.length) * 1.72);

  parts.push('BT');
  parts.push(`/F2 6 Tf ${n(textX)} ${n(H - pad - 7)} Td (${pdfText(site.name)}) Tj`);
  parts.push('ET');

  parts.push('BT');
  parts.push(`/F1 ${n(idSize)} Tf ${n(textX)} ${n(H / 2 - 3)} Td (${pdfText(printedId)}) Tj`);
  parts.push('ET');

  // WHICH OF THE FIVE THIS IS, in words rather than a number on its own.
  // "1 of 4" on a label a driver is holding is meaningless without knowing 1 of
  // 4 WHAT, and the answer is different for the tag and the stickers.
  const role = seq ? `STICKER ${seq} OF ${bags.STICKERS_PER_TAG}` : 'BAG TAG';
  parts.push('BT');
  parts.push(`/F2 6 Tf ${n(textX)} ${n(pad + 4)} Td (${pdfText(role)}) Tj`);
  parts.push('ET');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// The file itself.
//
// A PDF is a list of numbered objects, then a cross-reference table giving the
// BYTE OFFSET of each one, then a trailer pointing at the table. The offsets
// are why this is assembled as a list of chunks and measured as it goes: they
// have to be exact, and counting characters is not the same as counting bytes
// the moment anything is not ASCII.
// ---------------------------------------------------------------------------
function buildPdf(pages, label, dpi = DEFAULT_DPI) {
  const W = label.widthIn * PT;
  const H = label.heightIn * PT;

  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // PDF object numbers start at 1
  };

  // Reserve 1 and 2 for the catalog and the page tree, because the page
  // objects have to name their parent and the tree has to list its kids.
  const catalogId = add(null);
  const pagesId = add(null);

  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>');
  const smallId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  const pageIds = [];

  for (const page of pages) {
    const stream = labelStream(page, label, dpi);
    const streamId = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R ` +
          `/MediaBox [0 0 ${n(W)} ${n(H)}] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R /F2 ${smallId} 0 R >> >> ` +
          `/Contents ${streamId} 0 R >>`
      )
    );
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Count ${pageIds.length} ` +
    `/Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;

  const chunks = [];
  let offset = 0;
  const push = (text) => {
    const buf = Buffer.from(text, 'latin1');
    chunks.push(buf);
    offset += buf.length;
  };

  push('%PDF-1.4\n');
  // A comment of high bytes, which is the convention telling anything moving
  // this file around that it is binary and must not have its line endings
  // helpfully converted.
  push('%\xE2\xE3\xCF\xD3\n');

  const offsets = [];
  objects.forEach((body, i) => {
    offsets[i] = offset;
    push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefAt = offset;
  push(`xref\n0 ${objects.length + 1}\n`);
  push('0000000000 65535 f \n');
  for (const at of offsets) push(`${String(at).padStart(10, '0')} 00000 n \n`);

  push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n` +
      `startxref\n${xrefAt}\n%%EOF\n`
  );

  return Buffer.concat(chunks);
}

// One bag tag becomes a tag label plus one per sticker. Every one
// carries the same id and its own QR, exactly as the sheet does - so a bag
// labelled from a roll and a bag labelled from a sheet are the same bag to
// everything downstream.
// NO SEPARATE BAG TAG LABEL, at Neil's request: three labels off the roll per
// bag, numbered -1 to -3, and that is all.
//
// The sheet version prints a tag AND its stickers, because there the tag is a
// physical object the stickers are attached to. A roll has no such object -
// every label is the same kind of thing - so the tag label was a fourth sticker
// with a different word on it, and Neil counted it as one. He was right to.
//
// NOTHING IN THE SYSTEM NEEDS IT. bag_labels still has its intake row with a
// null sticker_seq, and findByCode() resolves that row whichever label is
// scanned, so binding a bag by scanning -1 works exactly as binding it by
// scanning the tag did. What changed is what comes out of the printer, not what
// the database believes.
//
// THE COST, WRITTEN DOWN: three labels means the driver uses one on the bag he
// collects, leaving two for bags the laundromat packs. An order that comes back
// as three bags runs one short. Neil chose this knowing that; if it bites,
// STICKERS_PER_TAG is the one number to change.
async function pagesForCode(code, { stickers = bags.STICKERS_PER_TAG, includeTag = false } = {}) {
  const wanted = [];
  if (includeTag) wanted.push(null);
  for (let i = 1; i <= stickers; i += 1) wanted.push(i);

  const pages = [];
  for (const seq of wanted) {
    // Q, NOT H, AND IT IS THE OTHER HALF OF THE FIX.
    //
    // H fits our URL into 41x41 modules; Q does it in 33x33. On a one-inch
    // label that is 4 dots a module against 5 - a 25% bigger module, which is
    // the difference between a head that can resolve it and one that cannot.
    //
    // Q still tolerates about 25% of the code being damaged against H's 30%,
    // which is a small price. A code with more redundancy that the printer
    // cannot render finely enough is not more robust, it is just unreadable
    // with a bigger margin for error nobody can use.
    const qr = QRCode.create(bags.labelUrl(code, seq), { errorCorrectionLevel: 'Q' });
    pages.push({
      code,
      seq,
      matrix: qr.modules.data,
      size: qr.modules.size,
    });
  }

  return pages;
}

// `codes` are bag tag ids. The PDF comes out in the order given, five pages per
// tag, so a print range in the Clabel dialog maps to whole tags: pages 1-5 are
// the first one, 6-10 the second.
async function forCodes(codes, options = {}) {
  const label = {
    widthIn: Number(options.widthIn) > 0 ? Number(options.widthIn) : DEFAULT_LABEL.widthIn,
    heightIn: Number(options.heightIn) > 0 ? Number(options.heightIn) : DEFAULT_LABEL.heightIn,
  };

  let pages = [];
  for (const code of codes) {
    pages = pages.concat(await pagesForCode(code, options));
  }

  const dpi = Number(options.dpi) > 0 ? Number(options.dpi) : DEFAULT_DPI;
  return { pdf: buildPdf(pages, label, dpi), pages: pages.length, label, dpi };
}

module.exports = { forCodes, pagesForCode, buildPdf, DEFAULT_LABEL, DEFAULT_DPI, PT };
