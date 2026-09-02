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

// ---------------------------------------------------------------------------
// LOADING THE VAN, ONE BAG AT A TIME.
//
// Neil's sequence, and the mirror of the pickup at a customer's door: scan it,
// weigh it, take the clip it gives you, confirm it is aboard. Then the next.
//
// ONE BAG ON THE SCREEN, like every other driver page here. A list invites
// working ahead, and working ahead at a tailgate is how a bag gets a weight
// that belongs to a different bag.
//
// The scan is a CONFIRMATION, not a search - he already has a bag in his hand
// and the screen already knows which ones are outstanding. It only agrees or
// shouts.
// ---------------------------------------------------------------------------

// THE TWO CHECKS, SAID PLAINLY TO THE DRIVER AND IN FULL TO AN ADMIN.
//
// Neil's split. A driver at a tailgate needs one line per check and a way
// onward: bags accounted for, weights agree, go. The numbers behind that are
// three scales and two comparisons per order, which is a paragraph he has no
// use for and would stop reading by the second one - and a check nobody reads
// is a check that is not happening.
//
// An admin gets the arithmetic, because they are the one who has to decide what
// a disagreement means.
//
// NOTHING HERE BLOCKS THE VAN. A failed check is shown, loudly, and the run can
// still be built: the bags are physically in the van by this point, and
// refusing to sequence them would leave a driver holding laundry with no route
// and no way to give it back. It is a thing to sort out, not a door to lock.
function reconciliation({ recon, showDetail }) {
  if (!recon || !recon.results.length) return '';

  const settled = recon.results.filter((r) => !r.pending);
  if (!settled.length) return '';

  const bagsOk = settled.every((r) => r.count.ok);

  const weightOk = settled.every(
    (r) =>
      !r.weight ||
      ((!r.weight.vsPartner || r.weight.vsPartner.band !== 'EXCEPTION') &&
        (!r.weight.vsCustomer || r.weight.vsCustomer.ok))
  );

  const line = (label, ok, detail) => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 0;
                border-bottom:1px solid var(--ink-100);">
      <span style="width:26px;height:26px;flex:none;border:2px solid var(--ink-900);border-radius:8px;
                   background:${ok ? 'var(--suds-500)' : 'var(--stain-500)'};
                   color:${ok ? 'var(--ink-900)' : 'var(--paper-050)'};
                   display:inline-flex;align-items:center;justify-content:center;
                   font-weight:700;font-size:15px;">${ok ? '&#10003;' : '!'}</span>
      <div style="min-width:0;">
        <div style="font-weight:700;font-size:16px;">${escapeHtml(label)}</div>
        <div style="font-size:14px;color:var(--ink-700);line-height:1.5;">${detail}</div>
      </div>
    </div>`;

  const bagCount = settled.reduce((t, r) => t + r.count.aboard, 0);
  const missing = settled.flatMap((r) => r.count.missing);

  const detail = () =>
    settled
      .map((r) => {
        const w = r.weight;
        return `
      <div style="padding:14px 0;border-bottom:1px solid var(--ink-100);">
        <div style="font-weight:700;font-size:15px;margin-bottom:6px;">
          Order #${escapeHtml(String(r.order.order_number))}
        </div>
        <dl style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0;font-size:14px;">
          <dt style="color:var(--ink-500);">Bags</dt>
          <dd style="margin:0;">${r.count.aboard} of ${r.count.collected} aboard</dd>

          <dt style="color:var(--ink-500);">On the van</dt>
          <dd style="margin:0;font-weight:700;">${w ? w.total.toFixed(1) : '-'} lb</dd>

          <dt style="color:var(--ink-500);">Laundromat said</dt>
          <dd style="margin:0;">${
            r.order.partner_weight_lb == null
              ? 'nothing'
              : `${Number(r.order.partner_weight_lb).toFixed(1)} lb${
                  w && w.vsPartner ? ` &middot; ${escapeHtml(w.vsPartner.band.toLowerCase())}` : ''
                }`
          }</dd>

          <dt style="color:var(--ink-500);">Collected dirty</dt>
          <dd style="margin:0;">${
            r.order.weight_lb == null
              ? 'not weighed'
              : `${Number(r.order.weight_lb).toFixed(1)} lb${
                  w && w.vsCustomer
                    ? w.vsCustomer.ok
                      ? ' &middot; within drying loss'
                      : ` &middot; <strong>${escapeHtml(w.vsCustomer.direction.toLowerCase())}</strong>`
                    : ''
                }`
          }</dd>
        </dl>
      </div>`;
      })
      .join('');

  return `
  <div class="card card-xl" style="padding:26px;margin-bottom:20px;
              background:${bagsOk && weightOk ? 'var(--suds-300)' : 'var(--stain-100)'};">
    <p class="eyebrow" style="margin:0 0 12px;">Before you drive</p>

    ${line(
      'Bag check',
      bagsOk,
      bagsOk
        ? `All ${bagCount} bag${bagCount === 1 ? '' : 's'} you picked up are in the van.`
        : `<strong>${missing.length} still not aboard:</strong> ${escapeHtml(missing.join(', '))}`
    )}

    ${line(
      'Weight check',
      weightOk,
      weightOk
        ? 'What you weighed agrees with the laundromat and with what you collected.'
        : 'The weights do not line up. It is recorded and somebody will look at it.'
    )}

    <p style="margin:16px 0 0;font-size:16px;font-weight:700;">
      ${bagsOk && weightOk ? 'All done. Ready to go.' : 'Logged. You can still drive - this is for the morning.'}
    </p>

    ${
      showDetail
        ? `<details style="margin-top:18px;">
             <summary style="cursor:pointer;font-weight:600;font-size:15px;">The numbers behind it</summary>
             <div style="margin-top:12px;">${detail()}</div>
           </details>`
        : ''
    }
  </div>`;
}

function loadWalkBody({ bags: outstanding, current, state, notice, problem, run, recon = null, showDetail = false }) {
  const done = run.length;

  const banner = (text, bg, fg = 'var(--ink-900)') => `
    <p style="margin:0 0 18px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
              background:${bg};color:${fg};font-size:16px;font-weight:600;">${escapeHtml(text)}</p>`;

  const name = current ? `${current.code}${current.sticker_seq ? `-${current.sticker_seq}` : ''}` : '';

  const step = () => {
    if (!current) return '';

    if (state === 'SCAN') {
      return `
      ${scanField({
        action: '/ops/loadout/pick',
        label: 'Scan the bag in your hand',
        buttonLabel: 'That one',
        autofocus: true,
        hint: describeCodeFormat(),
      })}

      <div style="margin-top:20px;padding-top:18px;border-top:2px solid var(--ink-100);">
        <p class="eyebrow" style="margin:0 0 10px;">Still to load</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${outstanding
            .map(
              (b) => `<span style="padding:7px 11px;border:2px solid var(--ink-900);border-radius:10px;
                                   background:var(--paper-000);font-family:var(--font-mono);
                                   font-weight:700;font-size:15px;">
                        ${escapeHtml(b.code)}${b.sticker_seq ? `-${b.sticker_seq}` : ''}
                      </span>`
            )
            .join('')}
        </div>
      </div>`;
    }

    if (state === 'WEIGH') {
      return `
      <form method="post" action="/ops/loadout/weigh" enctype="multipart/form-data" style="margin:0;">
        <input type="hidden" name="label_id" value="${escapeHtml(current.id)}">
        <label class="field-label" for="w">What does it weigh?</label>
        <input class="input input-lg" type="number" id="w" name="weight_lb" step="0.1" min="0.1" max="200"
               inputmode="decimal" required autofocus placeholder="Pounds" style="width:100%;">
        <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:16px;">
          Save and give me a clip
        </button>
      </form>`;
    }

    if (state === 'NO_CLIP') {
      return `
      ${banner('Every clip in the van is in use. Take one off a bag you have already dropped, then reload this page.', 'var(--stain-500)', 'var(--paper-050)')}
      <form method="post" action="/ops/loadout/loaded" style="margin:0;">
        <input type="hidden" name="label_id" value="${escapeHtml(current.id)}">
        <button type="submit" class="btn btn-lg btn-full">Put it in anyway</button>
      </form>`;
    }

    return `
      <div style="margin:0 0 20px;padding:18px 20px;border:2px solid var(--ink-900);border-radius:14px;
                  background:var(--sunbeam-500);text-align:center;">
        <p class="eyebrow" style="margin:0 0 8px;">Put this clip on it</p>
        <div style="font-family:var(--font-mono);font-weight:700;font-size:52px;line-height:1;">
          ${current.clip_number}
        </div>
      </div>
      <form method="post" action="/ops/loadout/loaded" style="margin:0;">
        <input type="hidden" name="label_id" value="${escapeHtml(current.id)}">
        <button type="submit" class="btn btn-primary btn-lg btn-full">It is in the van</button>
      </form>`;
  };

  return `
<div style="max-width:640px;">
  <a href="/ops/run" style="font-size:15px;font-weight:600;">&larr; Your round</a>
  <p class="eyebrow" style="margin:18px 0 6px;">Part of your round</p>
  <h1 style="margin:0 0 20px;font-size:36px;line-height:1.08;">Load the van</h1>

  ${problem ? banner(problem, 'var(--stain-500)', 'var(--paper-050)') : ''}
  ${notice ? banner(notice, 'var(--suds-300)') : ''}

  ${
    current
      ? `
  <div class="card card-xl" style="padding:28px;">
    <p class="eyebrow" style="margin:0 0 6px;">
      Bag ${done + 1} of ${done + outstanding.length}
    </p>
    <div style="font-family:var(--font-mono);font-size:34px;font-weight:700;letter-spacing:0.05em;
                line-height:1;margin-bottom:6px;">
      ${state === 'SCAN' ? 'Which bag?' : escapeHtml(name)}
    </div>
    <p style="font-size:15px;color:var(--ink-700);line-height:1.5;margin:0 0 22px;">
      ${
        state === 'SCAN'
          ? 'Scan it before it goes in. The screen already knows which are outstanding, so this only agrees or shouts.'
          : state === 'WEIGH'
            ? 'On the scale, then type what it says.'
            : state === 'NO_CLIP'
              ? 'Weighed. There is no free clip for it.'
              : `Weighed at ${Number(current.weight_lb).toFixed(1)} lb.`
      }
    </p>

    ${step()}

    <div style="height:12px;border:2px solid var(--ink-900);border-radius:999px;overflow:hidden;
                background:var(--paper-000);margin:24px 0 0;">
      <div style="height:100%;width:${Math.round((done / (done + outstanding.length)) * 100)}%;
                  background:var(--suds-500);"></div>
    </div>
  </div>`
      : `
  ${reconciliation({ recon, showDetail })}

  <div class="card card-xl" style="padding:28px;">
    <h2 style="font-family:var(--font-display);font-weight:900;font-size:26px;line-height:1.15;margin:0 0 10px;">
      Everything is aboard.
    </h2>
    <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">
      Build the run and it will put the stops in order - load in reverse,
      highest stop deepest, so stop 1 is by the doors.
    </p>
    <form method="post" action="/ops/loadout/build" style="margin:0;">
      <button type="submit" class="btn btn-primary btn-lg btn-full">Build the run</button>
    </form>
  </div>`
  }
</div>
${scannerScript()}`;
}

function loadoutBody({ run, built, notice, problem }) {
  // Largest stop number first. This IS the loading order.
  const loadOrder = run
    .slice()
    .sort((a, b) => (b.stop_number || 0) - (a.stop_number || 0));

  const numbered = run.filter((o) => o.stop_number != null).length;

  return `
<div style="max-width:720px;">
  <!-- A STEP OF THE ROUND, so it says where it sits and how to get back. This
       is not a place you navigate to any more - you arrive from the
       collect-from-the-laundromat stop and go straight back when it is done. -->
  <a href="/ops/run" style="font-size:15px;font-weight:600;">&larr; Your round</a>
  <p class="eyebrow" style="margin:18px 0 8px;">Part of your round</p>
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

module.exports = { loadoutBody, loadWalkBody };
