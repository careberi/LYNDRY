'use strict';

const { escapeHtml, icon } = require('./layout');
const { scanField, describeCodeFormat } = require('./scanner');

// ---------------------------------------------------------------------------
// The driver's run: one stop, one thing to do.
//
// Everything else in /ops is a screen you read. This is a screen you act on,
// and the difference shapes every decision in here:
//
//   ONE STOP. Not a list with the current one highlighted - a list invites
//   reading ahead, and reading ahead at a doorstep is how the wrong bag ends up
//   at the wrong house. What is behind and ahead is a count, not a list.
//
//   ONE ACTION. The order page offers every legal move; that is right when you
//   are looking something up and wrong when you are holding two bags. Here the
//   next incomplete task is the only control on the page.
//
//   BIG TARGETS. Full-width, 56px minimum, because this is used one-handed in
//   the rain.
//
// No JavaScript, like every other driver page. The camera button on a scan
// field is the exception it already was - it fills a text box that works
// perfectly well without it.
// ---------------------------------------------------------------------------

const CARD =
  'border:2px solid var(--ink-900);border-radius:16px;background:var(--paper-050);' +
  'box-shadow:var(--shadow-pop-sm);padding:26px;';

// What this stop is, in the words a driver would use.
const HEADLINE = {
  collect: 'Pick up',
  deliver: 'Deliver',
  dropoff: 'Drop the bags off',
  pickup_partner: 'Collect the finished bags',
};

function progressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `
  <div style="margin:0 0 22px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
      <span class="eyebrow" style="margin:0;">Stop ${Math.min(done + 1, total)} of ${total}</span>
      <span class="eyebrow" style="margin:0;">${done} done</span>
    </div>
    <div style="height:14px;border:2px solid var(--ink-900);border-radius:999px;overflow:hidden;background:var(--paper-000);">
      <div style="height:100%;width:${pct}%;background:var(--suds-500);"></div>
    </div>
  </div>`;
}

// --- the two halves of a stop ----------------------------------------------

// Before he is there: where to go, and a button that opens his maps app.
function travelCard(run) {
  const stop = run.current;

  return `
  <div style="${CARD}">
    <p class="eyebrow" style="margin:0 0 6px;">${escapeHtml(HEADLINE[stop.kind] || 'Next')}</p>
    <h2 style="font-family:var(--font-display);font-weight:900;font-size:30px;line-height:1.1;margin:0 0 6px;">
      ${escapeHtml(stop.name || stop.address || 'Somewhere with no address')}
    </h2>
    ${
      stop.name && stop.address
        ? `<p style="font-size:16px;line-height:1.5;margin:0 0 4px;">${escapeHtml(stop.address)}</p>`
        : ''
    }
    ${
      stop.eta
        ? `<p style="font-size:14px;color:var(--ink-500);margin:0 0 22px;">Due about ${escapeHtml(stop.eta)}</p>`
        : '<div style="height:18px;"></div>'
    }

    ${
      run.mapLink
        ? `<a class="btn btn-ink btn-lg btn-full" href="${escapeHtml(run.mapLink)}"
              target="_blank" rel="noopener" style="margin-bottom:14px;">
             Take me there ${icon('arrow-right', '22')}
           </a>`
        : `<p style="margin:0 0 14px;padding:12px 15px;border:2px solid var(--ink-900);border-radius:12px;
                     background:var(--stain-500);color:var(--paper-050);font-size:15px;line-height:1.5;">
             No address we can put on a map. Ring the office before you set off.
           </p>`
    }

    ${
      run.arrivalOrder
        ? `<form method="post" action="/ops/run/here" style="margin:0;">
             <input type="hidden" name="order_id" value="${escapeHtml(run.arrivalOrder.id)}">
             <button type="submit" class="btn btn-primary btn-lg btn-full">I'm here</button>
           </form>
           <p style="font-size:14px;color:var(--ink-500);line-height:1.5;margin:12px 0 0;">
             Tap that when you pull up and it will tell you what to do.
           </p>`
        : ''
    }
  </div>`;
}

// The one thing to do, now he is there.
function taskCard(run) {
  const stop = run.current;
  const task = run.task;
  const order = stop.order;

  // WHICH ORDER, AND WHICH CLIPS. "Deliver order 1003, clips 4, 6, 7 and 10" is
  // something a driver can act on with his hands full; four sticker codes are
  // not. Only on a delivery - on a pickup the bags do not have clips yet, the
  // screen is about to tell him which ones to put on.
  const clips = stop.kind === 'deliver' ? stop.clips || [] : [];

  const header = `
    <p class="eyebrow" style="margin:0 0 6px;">
      ${escapeHtml(HEADLINE[stop.kind] || '')}${order ? ` &middot; #${order.order_number}` : ''}
    </p>
    ${
      clips.length
        ? `<p style="margin:0 0 10px;font-size:16px;line-height:1.5;">
             <strong>Order #${order.order_number}</strong> &mdash;
             clip${clips.length === 1 ? '' : 's'}
             <strong style="font-family:var(--font-mono);">${clips.join(', ')}</strong>
           </p>`
        : ''
    }
    <h2 style="font-family:var(--font-display);font-weight:900;font-size:28px;line-height:1.12;margin:0 0 6px;">
      ${escapeHtml(task ? task.title : 'All done here')}
    </h2>
    ${
      task
        ? `<p style="font-size:16px;line-height:1.5;color:var(--ink-700);margin:0 0 22px;">${escapeHtml(task.detail)}</p>`
        : ''
    }`;

  // What is already ticked off at this stop, so he can see he has not skipped
  // anything - short enough not to be a list to read, long enough to reassure.
  const ticks = run.tasks.length
    ? `
    <div style="margin:22px 0 0;padding-top:18px;border-top:1px solid var(--ink-100);">
      ${run.tasks
        .map(
          (t) => `
      <div style="display:flex;align-items:center;gap:10px;padding:5px 0;font-size:14px;
                  color:${t.done ? 'var(--ink-900)' : 'var(--ink-500)'};">
        <span style="flex:none;width:18px;height:18px;border:2px solid var(--ink-900);border-radius:5px;
                     background:${t.done ? 'var(--suds-500)' : 'var(--paper-000)'};
                     display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">
          ${t.done ? '&check;' : ''}
        </span>
        ${escapeHtml(t.title)}
      </div>`
        )
        .join('')}
    </div>`
    : '';

  return `
  <div style="${CARD}">
    ${header}
    ${task ? taskControl(stop, task, order) : ''}
    ${ticks}
    <p style="font-size:13px;color:var(--ink-500);line-height:1.5;margin:18px 0 0;">
      ${escapeHtml(stop.address || '')}
      ${order ? ` &middot; <a href="/ops/orders/${order.order_number}">the full order</a>` : ''}
    </p>
  </div>`;
}

// The control for whatever the next incomplete task is.
//
// Every one of these posts to the SAME route the order page posts to. Nothing
// here is a second way to change an order - this file decides what to show, and
// src/core/fulfilment.js decides what happens.
function taskControl(stop, task, order) {
  const back = '?from=run';

  if (task.key === 'bag_count') {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/bag-count${back}" style="margin:0;">
      <label class="field-label" for="bag_count">Bags</label>
      <input class="input input-lg" type="number" id="bag_count" name="bag_count" min="1" max="20"
             inputmode="numeric" required autofocus placeholder="3" style="width:100%;margin-bottom:16px;">
      <button type="submit" class="btn btn-primary btn-lg btn-full">That's how many</button>
      <span class="field-hint" style="display:block;margin-top:10px;">
        Count them first. The screen then walks you through them one at a time.
      </span>
    </form>`;
  }

  // ONE BAG: a sticker, then the scale and a photo of it. Two forms, one after
  // the other, because the sticker has to exist before there is anything to
  // hang a weight on.
  if (task.key.startsWith('bag_')) {
    if (task.needsLabel) {
      return `
      ${scanField({
        action: `/ops/orders/${order.order_number}/label${back}`,
        label: `Code off the sticker for bag ${task.position}`,
        buttonLabel: `That's bag ${task.position}`,
        autofocus: true,
        hint: describeCodeFormat(),
      })}`;
    }

    return `
    <form method="post" action="/ops/orders/${order.order_number}/bag-weight${back}"
          enctype="multipart/form-data" style="margin:0;">
      <input type="hidden" name="code" value="${escapeHtml(task.label.code)}">

      <p style="margin:0 0 14px;font-size:15px;">
        Sticker <code style="font-weight:700;">${escapeHtml(task.label.code)}</code> is on it.
        A numbered clip goes on once you have weighed it - the screen will tell
        you which one.
      </p>

      <label class="field-label" for="weight_lb">What does bag ${task.position} weigh?</label>
      <input class="input input-lg" type="number" id="weight_lb" name="weight_lb"
             step="0.1" min="0.1" max="200" inputmode="decimal" required autofocus
             placeholder="12.5" style="width:100%;margin-bottom:16px;">

      <label class="field-label" for="photo">Photo of the scale</label>
      <input class="input input-lg" type="file" id="photo" name="photo"
             accept="image/*" capture="environment" required style="width:100%;margin-bottom:16px;">

      <button type="submit" class="btn btn-primary btn-lg btn-full">Save bag ${task.position}</button>
      <span class="field-hint" style="display:block;margin-top:10px;">
        Photograph the display with the bag on it. That photo settles any argument
        about the number later.
      </span>
    </form>`;
  }

  if (task.key === 'collected') {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/collected${back}" style="margin:0;">
      <button type="submit" class="btn btn-primary btn-lg btn-full">In the van</button>
      <span class="field-hint" style="display:block;margin-top:10px;">
        All of them weighed and stickered. Tap this once they are actually loaded.
      </span>
    </form>`;
  }

  if (task.key === 'scan') {
    return `
    ${scanField({
      action: `/ops/orders/${order.order_number}/door-scan${back}`,
      label: 'Bag in your hand',
      buttonLabel: 'Check it',
      autofocus: true,
      hint: describeCodeFormat(),
    })}
    <div style="margin-top:16px;">
      ${(task.scan.labels || [])
        .map(
          (l) => `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--ink-100);">
        <span style="flex:none;width:20px;height:20px;border:2px solid var(--ink-900);border-radius:6px;
                     background:${l.delivered_at ? 'var(--suds-500)' : 'var(--paper-000)'};
                     display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">
          ${l.delivered_at ? '&check;' : ''}
        </span>
        <code style="font-size:15px;font-weight:700;">${escapeHtml(l.code)}</code>
        <span style="font-size:13px;color:var(--ink-500);">bag ${l.position}</span>
      </div>`
        )
        .join('')}
    </div>`;
  }

  if (task.key === 'delivered') {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/delivered${back}"
          enctype="multipart/form-data" style="margin:0;">
      <label class="field-label" for="photo">Photo where you left them</label>
      <input class="input input-lg" type="file" id="photo" name="photo"
             accept="image/*" capture="environment" required style="width:100%;margin-bottom:16px;">
      <button type="submit" class="btn btn-primary btn-lg btn-full">Delivered</button>
      <span class="field-hint" style="display:block;margin-top:10px;">
        One picture of the drop-off, however many bags there were.
      </span>
    </form>`;
  }

  return '';
}

// The laundromat stops. Dropping off is a button per visit; collecting finished
// bags back is the load-out pass, which is its own screen and already does this
// properly - a worse second version of it here would be two ways to do one job.
function partnerCard(run) {
  const stop = run.current;
  const dropping = stop.kind === 'dropoff';

  return `
  <div style="${CARD}">
    <p class="eyebrow" style="margin:0 0 6px;">${escapeHtml(HEADLINE[stop.kind])}</p>
    <h2 style="font-family:var(--font-display);font-weight:900;font-size:28px;line-height:1.12;margin:0 0 6px;">
      ${escapeHtml(stop.name || 'The laundromat')}
    </h2>
    <p style="font-size:16px;line-height:1.5;margin:0 0 4px;">${escapeHtml(stop.address || '')}</p>
    <p style="font-size:15px;color:var(--ink-700);line-height:1.5;margin:0 0 16px;">
      ${stop.bags} bag${stop.bags === 1 ? '' : 's'}${stop.pounds ? `, ${stop.pounds.toFixed(0)} lb` : ''}.
    </p>

    ${
      // THE NUMBERS, BIG. This is the one thing said out loud at a counter, so
      // it is the one thing that has to be readable at arm's length.
      (stop.clips || []).length
        ? `<div style="margin:0 0 22px;padding:16px 18px;border:2px solid var(--ink-900);border-radius:14px;
                      background:var(--sunbeam-500);">
             <p class="eyebrow" style="margin:0 0 10px;">${
               dropping ? 'Hand over these' : 'Bringing back'
             }</p>
             <div style="display:flex;flex-wrap:wrap;gap:10px;">
               ${(stop.clips || [])
                 .map(
                   (n) => `<span style="min-width:46px;padding:8px 12px;border:2px solid var(--ink-900);
                                        border-radius:10px;background:var(--paper-000);text-align:center;
                                        font-family:var(--font-mono);font-weight:700;font-size:20px;">
                             ${n}
                           </span>`
                 )
                 .join('')}
             </div>
             <p style="margin:12px 0 0;font-size:14px;line-height:1.5;">
               ${
                 dropping
                   ? 'Take the clips off as you hand them over - those numbers go back in the van for the next bags.'
                   : 'These are what you are collecting.'
               }
             </p>
           </div>`
        : ''
    }

    ${
      dropping
        ? `<form method="post" action="/ops/run/dropped" style="margin:0;">
             <input type="hidden" name="partner_id" value="${escapeHtml((stop.partner || {}).id || '')}">
             ${(stop.orders || [])
               .map((o) => `<input type="hidden" name="order_id" value="${escapeHtml(o.id)}">`)
               .join('')}
             <button type="submit" class="btn btn-primary btn-lg btn-full">
               Handed over ${stop.bags === 1 ? 'the bag' : `all ${stop.bags} bags`}
             </button>
           </form>`
        : `<a class="btn btn-primary btn-lg btn-full" href="/ops/loadout">
             Scan them into the van ${icon('arrow-right', '22')}
           </a>
           <p style="font-size:14px;color:var(--ink-500);line-height:1.5;margin:12px 0 0;">
             Every bag gets scanned out and the van is loaded in reverse, so stop 1
             is by the door. Come back here when that is done.
           </p>`
    }
  </div>`;
}

// --- the page ---------------------------------------------------------------

function runBody({ run, notice = null, problem = null }) {
  const banner = (text, background, colour = 'var(--ink-900)') => `
    <p style="margin:0 0 20px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
              background:${background};color:${colour};font-size:15px;line-height:1.5;font-weight:600;">
      ${escapeHtml(text)}
    </p>`;

  const head = `
  <div style="max-width:560px;margin:0 auto;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:18px;flex-wrap:wrap;">
      <h1 style="font-family:var(--font-display);font-weight:900;font-size:32px;line-height:1;margin:0;">
        Your round
      </h1>
      <a href="/ops" style="font-size:15px;font-weight:600;">All orders</a>
    </div>

    ${problem ? banner(problem, 'var(--stain-500)', 'var(--paper-050)') : ''}
    ${notice ? banner(notice, 'var(--suds-300)') : ''}`;

  if (!run.total) {
    return `${head}
    <div style="${CARD}">
      <h2 style="font-family:var(--font-display);font-weight:900;font-size:26px;line-height:1.15;margin:0 0 10px;">
        Nothing on today
      </h2>
      <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0;">
        No pickups booked to you and nothing in the van. If that looks wrong,
        check the <a href="/ops">orders board</a> - an order with no driver on it
        will not appear here.
      </p>
    </div>
  </div>`;
  }

  if (run.finished) {
    return `${head}
    ${progressBar(run.done, run.total)}
    <div style="${CARD}background:var(--suds-300);">
      <h2 style="font-family:var(--font-display);font-weight:900;font-size:28px;line-height:1.15;margin:0 0 10px;">
        That's the round.
      </h2>
      <p style="font-size:16px;line-height:1.6;margin:0;">
        All ${run.total} stop${run.total === 1 ? '' : 's'} done. Anything that comes
        in later will show up here.
      </p>
    </div>
  </div>`;
  }

  const partnerStop = run.current.kind === 'dropoff' || run.current.kind === 'pickup_partner';

  return `${head}
    ${progressBar(run.done, run.total)}
    ${run.arrived ? (partnerStop ? partnerCard(run) : taskCard(run)) : travelCard(run)}
  </div>`;
}

module.exports = { runBody };
