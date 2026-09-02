'use strict';

const { escapeHtml } = require('./layout');
const reports = require('../core/reports');

// ---------------------------------------------------------------------------
// THE RECONCILIATION SCREEN.
//
// Neil's ask, in his order: the laundromat, the order number, what it weighed
// when it came in, what the laundromat said it weighed, what it weighed coming
// back out, any additions, the weight actually billed, what the customer paid,
// and what we will be invoiced. Then a CSV of the same thing.
//
// IT IS A TABLE AND IT SCROLLS SIDEWAYS. Fifteen columns do not fit a phone and
// pretending otherwise produces a table with three readable columns and the
// interesting ones off the edge. The scroll container is the table's own, so
// the page body never scrolls sideways - the rule the design system already
// keeps for code blocks and diagrams.
//
// EMPTY IS NOT ZERO, and the page says so with a dash. An order nobody has
// weighed has no weight; printing 0.0 lb there would put a real-looking number
// in a column somebody is about to invoice against.
// ---------------------------------------------------------------------------

function lb(v) {
  return v == null ? '<span style="color:var(--ink-300);">-</span>' : `${Number(v).toFixed(1)}`;
}

function cash(cents) {
  return cents == null
    ? '<span style="color:var(--ink-300);">-</span>'
    : `$${reports.money(cents)}`;
}

// The drift between their scale and ours, coloured by which way it went.
// Heavier than us costs money; lighter is the ordinary direction and does not.
function drift(row) {
  if (row.driftLb == null) return '<span style="color:var(--ink-300);">-</span>';
  const heavy = row.driftLb > 0;
  const sign = heavy ? '+' : '';
  return `<span style="font-weight:700;color:${
    heavy ? 'var(--stain-600, #B8321F)' : 'var(--ink-500)'
  };">${sign}${row.driftLb.toFixed(1)}</span>`;
}

function reportsBody({ report, partners = [], form = {} }) {
  const { rows, start, end } = report;
  const totals = reports.totals(rows);

  const query = new URLSearchParams();
  if (form.from) query.set('from', form.from);
  if (form.to) query.set('to', form.to);
  if (form.partner) query.set('partner', form.partner);
  const csvHref = `/ops/reports.csv${query.toString() ? `?${query}` : ''}`;

  // WHAT IS MISSING, SAID PLAINLY AT THE TOP.
  //
  // A total built from half the orders is not wrong, it is partial - and the
  // difference matters when the number is going on an invoice. So the counts
  // come first and the money second.
  const gaps = [];
  if (totals.partnerWeighed < totals.orders) {
    gaps.push(
      `${totals.orders - totals.partnerWeighed} of ${totals.orders} have no laundromat weight, so they are missing from the invoice total.`
    );
  }
  if (totals.additionsCents > 0) {
    gaps.push(
      `${cash(totals.additionsCents).replace(/<[^>]*>/g, '')} of add-ons were chosen and none of it was billed - the pricing code has never charged them.`
    );
  }

  const th = (label, extra = '') =>
    `<th style="text-align:${
      extra || 'left'
    };padding:10px 12px;border-bottom:2px solid var(--ink-900);white-space:nowrap;
        font-family:var(--font-mono);font-size:11px;letter-spacing:0.07em;text-transform:uppercase;">${label}</th>`;

  const td = (content, align = 'left', extra = '') =>
    `<td style="padding:11px 12px;border-bottom:1px solid var(--ink-100);text-align:${align};
        white-space:nowrap;${extra}">${content}</td>`;

  return `
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:8px;">
    <h1 style="font-family:var(--font-display);font-weight:900;font-size:34px;line-height:1;margin:0;">
      Weights and money
    </h1>
    <a class="btn btn-sm" href="${escapeHtml(csvHref)}">Export CSV</a>
  </div>

  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);max-width:70ch;margin:0 0 22px;">
    Every order that went to a laundromat, with all three weights side by side.
    <strong>The customer is billed on the heavier of ours and theirs</strong>;
    the laundromat invoices us on their own figure. Nothing here changes
    anything - it is a reading of what happened.
  </p>

  <form method="get" action="/ops/reports"
        style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin:0 0 24px;
               padding:18px 20px;border:2px solid var(--ink-900);border-radius:14px;
               background:var(--paper-050);box-shadow:var(--shadow-pop-xs);">
    <div>
      <label class="field-label" for="from">From</label>
      <input class="input" type="date" id="from" name="from" value="${escapeHtml(start)}">
    </div>
    <div>
      <label class="field-label" for="to">To</label>
      <input class="input" type="date" id="to" name="to" value="${escapeHtml(end)}">
    </div>
    <div>
      <label class="field-label" for="partner">Laundromat</label>
      <select class="select" id="partner" name="partner">
        <option value="">All of them</option>
        ${partners
          .map(
            (p) =>
              `<option value="${escapeHtml(p.id)}"${
                form.partner === p.id ? ' selected' : ''
              }>${escapeHtml(p.name)}</option>`
          )
          .join('')}
      </select>
    </div>
    <button class="btn" type="submit">Show it</button>
  </form>

  ${
    gaps.length
      ? `<div style="margin:0 0 22px;padding:15px 18px;border:2px solid var(--ink-900);border-radius:13px;
                     background:var(--sunbeam-500);">
           <p class="eyebrow" style="margin:0 0 8px;">Read this before you invoice</p>
           <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.6;">
             ${gaps.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}
           </ul>
         </div>`
      : ''
  }

  ${
    rows.length
      ? `
  <div style="overflow-x:auto;border:2px solid var(--ink-900);border-radius:14px;
              background:var(--paper-050);box-shadow:var(--shadow-pop-sm);">
    <table style="width:100%;border-collapse:collapse;font-size:15px;
                  font-variant-numeric:tabular-nums;">
      <thead>
        <tr>
          ${th('Laundromat')}
          ${th('Order')}
          ${th('In, ours', 'right')}
          ${th('They said', 'right')}
          ${th('Drift', 'right')}
          ${th('Back out', 'right')}
          ${th('Add-ons', 'right')}
          ${th('Billed on', 'right')}
          ${th('Customer paid', 'right')}
          ${th('Should be', 'right')}
          ${th('We are invoiced', 'right')}
          ${th('Left over', 'right')}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((r) => {
            // The one comparison worth colouring in the money columns: charged
            // against what the rules say it should have been.
            const short =
              r.chargedCents != null && r.expectedCents != null && r.chargedCents < r.expectedCents;

            return `
        <tr>
          ${td(escapeHtml(r.partnerName || 'not sent to one'))}
          ${td(
            `<a href="/ops/orders/${escapeHtml(r.orderNumber)}" style="font-weight:700;color:inherit;">#${escapeHtml(
              r.orderNumber
            )}</a>`
          )}
          ${td(lb(r.ourWeightLb), 'right')}
          ${td(lb(r.partnerWeightLb), 'right')}
          ${td(drift(r), 'right')}
          ${td(lb(r.returnWeightLb), 'right')}
          ${td(r.additionsCents ? cash(r.additionsCents) : '<span style="color:var(--ink-300);">-</span>', 'right')}
          ${td(`<strong>${lb(r.billedWeightLb)}</strong>`, 'right')}
          ${td(cash(r.chargedCents), 'right', short ? 'color:var(--stain-600, #B8321F);font-weight:700;' : '')}
          ${td(cash(r.expectedCents), 'right', 'color:var(--ink-500);')}
          ${td(cash(r.partnerOwedCents), 'right')}
          ${td(`<strong>${cash(r.grossCents)}</strong>`, 'right')}
        </tr>`;
          })
          .join('')}
      </tbody>
      <tfoot>
        <tr style="background:var(--paper-200);">
          ${td('<strong>Total</strong>')}
          ${td(`<strong>${totals.orders}</strong>`)}
          ${td(`<strong>${totals.ourWeightLb.toFixed(1)}</strong>`, 'right')}
          ${td(`<strong>${totals.partnerWeightLb.toFixed(1)}</strong>`, 'right')}
          ${td('', 'right')}
          ${td(`<strong>${totals.returnWeightLb.toFixed(1)}</strong>`, 'right')}
          ${td(`<strong>${cash(totals.additionsCents)}</strong>`, 'right')}
          ${td(`<strong>${totals.billedWeightLb.toFixed(1)}</strong>`, 'right')}
          ${td(`<strong>${cash(totals.chargedCents)}</strong>`, 'right')}
          ${td(`<strong>${cash(totals.expectedCents)}</strong>`, 'right', 'color:var(--ink-500);')}
          ${td(`<strong>${cash(totals.partnerOwedCents)}</strong>`, 'right')}
          ${td(`<strong>${cash(totals.grossCents)}</strong>`, 'right')}
        </tr>
      </tfoot>
    </table>
  </div>

  <p style="font-size:14px;line-height:1.6;color:var(--ink-500);margin:18px 0 0;max-width:70ch;">
    <strong>Drift</strong> is their scale against ours, and the sign is kept on
    purpose: heavier than us costs money, lighter is the ordinary direction.
    <strong>Should be</strong> is the billed weight at this order's own stored
    rate plus its add-ons - it is what the rules say, not what was taken.
    <strong>Left over</strong> is what the customer paid minus what the
    laundromat is owed, before the van, the wage and the card fees.
  </p>`
      : `<p style="font-size:16px;color:var(--ink-500);">
           Nothing between those dates.
         </p>`
  }`;
}

module.exports = { reportsBody };
