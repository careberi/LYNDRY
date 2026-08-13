'use strict';

const { escapeHtml } = require('./layout');
const { scanField, scannerScript, describeCodeFormat } = require('./scanner');

// ---------------------------------------------------------------------------
// The load-out screen: /ops/loadout
//
// One job, done standing up in a laundromat holding a bag. So the scan field
// is the first thing on the page and everything else is underneath it.
//
// The load list is printed in REVERSE stop order, largest number first, and
// that is not a display quirk - it is the instruction. Stop 12 goes in deepest
// and stop 1 by the door, so every bag is at the tailgate when it is needed.
// Loading front-to-back with numbered tags means climbing over stop 9 to reach
// stop 2, which is exactly the pile the numbers were meant to replace.
// ---------------------------------------------------------------------------

function stopPill(n, tone) {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;
    min-width:44px;height:44px;padding:0 10px;border:2px solid var(--ink-900);border-radius:12px;
    background:${tone};box-shadow:var(--shadow-pop-xs);
    font-family:var(--font-mono);font-weight:700;font-size:19px;color:var(--ink-900);">${n}</span>`;
}

function orderRow(order, { reverse }) {
  const c = order.customers || {};
  const address = [c.address_line1, c.address_line2].filter(Boolean).join(', ');
  const bagCount = (order.bags || []).length;
  const loadedBags = (order.bags || []).filter((b) => b.loaded_at).length;

  const numbered = order.stop_number != null;
  const partial = bagCount > 0 && loadedBags < bagCount;

  return `
  <div style="display:flex;gap:16px;align-items:flex-start;padding:16px 0;border-bottom:1px solid var(--ink-100);">
    ${stopPill(
      numbered ? order.stop_number : '?',
      numbered ? (reverse ? 'var(--lilac-500)' : 'var(--suds-500)') : 'var(--paper-200)'
    )}
    <div style="flex:1;min-width:0;">
      <div style="font-weight:700;font-size:17px;">
        #${order.order_number} &middot; ${escapeHtml(c.name || 'Unknown')}
      </div>
      <div style="font-size:15px;color:var(--ink-700);margin-top:2px;">${escapeHtml(address || 'No address')}</div>
      <div style="font-family:var(--font-mono);font-size:12px;color:${
        partial ? 'var(--stain-500)' : 'var(--ink-500)'
      };margin-top:5px;font-weight:${partial ? '700' : '400'};">
        ${
          bagCount
            ? `${loadedBags} of ${bagCount} bag${bagCount === 1 ? '' : 's'} in the van`
            : 'No labelled bags'
        }${order.located === false ? ' &middot; address not found, sorted last' : ''}
      </div>
    </div>
    <a href="/ops/orders/${order.order_number}" style="font-size:14px;font-weight:600;white-space:nowrap;">Open</a>
  </div>`;
}

function loadoutBody({ run, built, notice, problem }) {
  // Largest stop number first. This IS the loading order.
  const loadOrder = run
    .slice()
    .sort((a, b) => (b.stop_number || 0) - (a.stop_number || 0));

  const numbered = run.filter((o) => o.stop_number != null).length;

  return `
<div style="max-width:720px;">
  <p class="eyebrow" style="margin:0 0 8px;">Load the van</p>
  <h1 style="margin:0 0 14px;font-size:40px;line-height:1.05;">Scan every bag into the van</h1>
  <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0 0 26px;">
    One pass, in whatever order they come to hand - you are touching each bag
    anyway. When they are all in, build the run and it will tell you which stop
    each one is.
  </p>

  ${
    problem
      ? `<p style="margin:0 0 20px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
                   background:var(--stain-500);color:var(--paper-050);font-size:17px;font-weight:700;">
           ${escapeHtml(problem)}
         </p>`
      : ''
  }
  ${
    notice
      ? `<p style="margin:0 0 20px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
                   background:var(--suds-300);font-size:16px;font-weight:600;">
           ${escapeHtml(notice)}
         </p>`
      : ''
  }

  <div class="card card-xl" style="padding:24px;margin-bottom:28px;">
    ${scanField({
      action: '/ops/loadout/scan',
      label: 'Scan a bag',
      buttonLabel: 'Add',
      autofocus: true,
      hint: describeCodeFormat(),
    })}
  </div>

  ${
    run.length
      ? `
  <div class="card card-xl" style="padding:24px;margin-bottom:28px;">
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;justify-content:space-between;margin-bottom:6px;">
      <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0;">
        In the van
      </h2>
      <span class="eyebrow" style="margin:0;">${run.length} stop${run.length === 1 ? '' : 's'}</span>
    </div>

    ${run.map((o) => orderRow(o, { reverse: false })).join('')}

    <form method="post" action="/ops/loadout/build" style="margin:22px 0 0;">
      <button type="submit" class="btn btn-lg btn-full">
        ${numbered ? 'Work the run out again' : 'Build the run'}
      </button>
      <span class="field-hint" style="display:block;margin-top:10px;">
        Puts the stops in driving order and gives each bag a number. Do it once
        everything is scanned - looking up a new address takes a second each.
      </span>
    </form>
  </div>`
      : `
  <div class="card card-xl" style="padding:28px;margin-bottom:28px;">
    <p style="margin:0;font-size:16px;color:var(--ink-500);line-height:1.6;">
      Nothing in the van yet. Scan the first bag above.
    </p>
  </div>`
  }

  ${
    built && numbered
      ? `
  <div class="card card-xl" style="padding:24px;background:var(--lilac-100);">
    <h2 style="font-family:var(--font-display);font-weight:900;font-size:24px;margin:0 0 6px;">
      Load in this order
    </h2>
    <p style="font-size:15px;line-height:1.6;color:var(--ink-700);margin:0 0 10px;">
      <strong>Highest number goes in first, deepest.</strong> Stop 1 goes in
      last, by the door. Clip the numbered tag on as you put each one down and
      every bag will be at the tailgate when you get there.
    </p>
    ${loadOrder.map((o) => orderRow(o, { reverse: true })).join('')}
  </div>`
      : ''
  }
</div>

${scannerScript()}`;
}

module.exports = { loadoutBody };
