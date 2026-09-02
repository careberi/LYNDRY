'use strict';

const { escapeHtml, icon } = require('./layout');
const { scanField, scannerScript, describeCodeFormat } = require('./scanner');

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
        ? // THROUGH US ON THE WAY TO THE MAP, so the page knows he set off and
          // can offer the arrival button afterwards. Same tab on purpose: a new
          // tab would leave this page untouched and still showing the button he
          // has already tapped.
          `<a class="btn btn-${run.navigating ? 'outline' : 'ink'} btn-lg btn-full"
              href="/ops/run/going/${escapeHtml(run.arrivalOrder ? run.arrivalOrder.id : '')}?to=${encodeURIComponent(
                run.current.address || ''
              )}"
              style="margin-bottom:14px;">
             ${run.navigating ? 'Directions again' : 'Take me there'} ${icon('arrow-right', '22')}
           </a>`
        : `<p style="margin:0 0 14px;padding:12px 15px;border:2px solid var(--ink-900);border-radius:12px;
                     background:var(--stain-500);color:var(--paper-050);font-size:15px;line-height:1.5;">
             ${
               stop.kind === 'dropoff'
                 ? 'No laundromat has been picked for these bags. Nobody is open, or none is set up. Sort that on Routing before you drive anywhere.'
                 : 'No address we can put on a map. Ring the office before you set off.'
             }
           </p>`
    }

    ${
      // A PLAN IS NOT THE SAME AS A LIVE CHOICE, so it does not get to look
      // like one. This is where the order was meant to go when it was booked;
      // by now that laundromat may be shut or full, and the driver should ring
      // ahead rather than turn up on the strength of a week-old decision.
      stop.fromPlan
        ? `<p style="margin:0 0 14px;padding:12px 15px;border:2px solid var(--ink-900);border-radius:12px;
                     background:var(--sunbeam-500);font-size:15px;line-height:1.5;">
             This is where the order was <strong>planned</strong> to go when it
             was booked. Nothing confirmed it is open right now, so ring ahead.
           </p>`
        : ''
    }

    ${
      // NO DESTINATION, NO ARRIVAL. Offering "I'm here" for a stop the screen
      // cannot name asks the driver to confirm he has reached somewhere nobody
      // has decided on, and marks the order arrived at a place that does not
      // exist. The line above tells him what to do instead.
      // ONE THING AT A TIME: directions, THEN arrival. Neil's call, and not
      // only tidiness - "I'm here" is what unlocks the tasks for this stop, so
      // a driver who can reach it without opening the directions can confirm
      // he has arrived somewhere he never drove to, and the screen will then
      // walk him through collecting a bag at the wrong door.
      //
      // Absent rather than disabled, like every other not-yet step on this
      // screen. A greyed-out button invites tapping and explains nothing.
      run.arrivalOrder && (stop.address || stop.kind === 'collect') && run.navigating
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

  // ONE BAG, TWO STEPS: the tag, then the scale and a photo of it. Separate
  // tasks rather than one, because the tag has to exist before there is
  // anything to hang a weight on - and because a driver who has stuck one on
  // deserves to see that step tick over rather than the same unfinished line.
  if (task.key.startsWith('tag_')) {
    return `
      ${scanField({
        action: `/ops/orders/${order.order_number}/label${back}`,
        label: `Code off the tag for bag ${task.position}`,
        buttonLabel: `That's bag ${task.position}`,
        autofocus: true,
        hint: describeCodeFormat(),
      })}`;
  }

  if (task.key.startsWith('weigh_')) {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/bag-weight${back}"
          enctype="multipart/form-data" style="margin:0;">
      <input type="hidden" name="code" value="${escapeHtml(task.label.code)}">

      <p style="margin:0 0 14px;font-size:15px;">
        Tag <code style="font-weight:700;">${escapeHtml((task.label || {}).code || '')}</code> is on it.
        A numbered clip goes on once you have weighed it - the screen will tell
        you which one.
      </p>

      <label class="field-label" for="weight_lb">What does bag ${task.position} weigh?</label>
      <input class="input input-lg" type="number" id="weight_lb" name="weight_lb"
             step="0.1" min="0.1" max="200" inputmode="decimal" required autofocus
             placeholder="12.5" style="width:100%;margin-bottom:16px;">

      <button type="submit" class="btn btn-primary btn-lg btn-full">Save bag ${task.position}</button>
      <span class="field-hint" style="display:block;margin-top:10px;">
        This is what prices the bag. The card is charged when you mark the order
        delivered.
      </span>
    </form>`;
  }

  // STEP ONE NOW, not the last thing. He is handed the bags and then deals with
  // them, which is the real order of events at a door - and marking it
  // collected is what texts the customer to say we have been, so making that
  // wait until the last bag is on the scale would delay their message for
  // nothing.
  if (task.key === 'collected') {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/collected${back}" style="margin:0;">
      <button type="submit" class="btn btn-primary btn-lg btn-full">
        ${order.bag_count ? `Got all ${order.bag_count}` : 'I have the bags'}
      </button>
      <span class="field-hint" style="display:block;margin-top:10px;">
        Take them from the customer, then tap this. It texts them to say we have been.
      </span>
    </form>`;
  }

  // THE LAST STEP, and it is not the same as the last bag being weighed. The
  // clips were handed out at the scale; what nothing else can tell us is
  // whether the bags actually made it into the van.
  if (task.key === 'van') {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/in-van${back}" style="margin:0;">
      ${
        (task.clips || []).length
          ? `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;">
               ${task.clips
                 .map(
                   (n) => `<span style="min-width:54px;padding:10px 14px;border:2px solid var(--ink-900);
                                        border-radius:12px;background:var(--sunbeam-500);text-align:center;
                                        font-family:var(--font-mono);font-weight:700;font-size:22px;">${n}</span>`
                 )
                 .join('')}
             </div>`
          : ''
      }
      <button type="submit" class="btn btn-primary btn-lg btn-full">They are in the van</button>
      <span class="field-hint" style="display:block;margin-top:10px;">
        Put those clips on, load them, then tap this.
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
      // TICK EACH BAG OFF AS IT COMES INTO YOUR HANDS.
      //
      // NEIL'S FLOW, and the unit is the point: these are ALL the finished bags
      // at this laundromat, whoever they belong to. He is standing at a counter
      // being handed bags one at a time - he does not sort them into orders as
      // he goes and should not have to, because the sticker already says which
      // order each one is.
      //
      // Not collected, tap, collected. Tap again if he sets one down: a mis-tap
      // at a counter has nobody to undo it.
      //
      // THE WEIGHING COMES AFTER, not interleaved. Gather everything, then
      // weigh the load, then the check against what we collected from the
      // customer, then the clips - which is the original sequence with the
      // picking-up separated out in front of it.
      !dropping && (stop.finishedBags || []).length
        ? (() => {
            const bags = stop.finishedBags;
            const left = bags.filter((b) => !b.collected_at).length;

            return `
           <div style="margin:0 0 18px;padding:16px 18px;border:2px solid var(--ink-900);border-radius:14px;
                       background:var(--paper-200);">
             <p class="eyebrow" style="margin:0 0 4px;">Pick these up</p>
             <p style="font-size:15px;line-height:1.5;margin:0 0 14px;">
               ${
                 left
                   ? `Tap each one as they hand it to you. <strong>${left} still to go.</strong>`
                   : 'All of them are in the van. Weigh the load next.'
               }
             </p>

             <form method="post" action="/ops/run/collected"
                   style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
               ${bags
                 .map((b) => {
                   const got = Boolean(b.collected_at);
                   return `
               <button type="submit" name="label_id" value="${escapeHtml(b.id)}"
                       style="width:100%;padding:14px 10px;border:2px solid var(--ink-900);
                              border-radius:12px;box-shadow:var(--shadow-pop-xs);cursor:pointer;
                              background:${got ? 'var(--suds-500)' : 'var(--paper-000)'};">
                 <span style="display:block;font-family:var(--font-mono);font-weight:700;font-size:16px;">
                   ${escapeHtml(b.code)}${b.sticker_seq ? `-${b.sticker_seq}` : ''}
                 </span>
                 <span style="display:block;font-family:var(--font-mono);font-size:11px;letter-spacing:0.07em;
                              text-transform:uppercase;margin-top:4px;">
                   ${got ? 'Collected' : 'Not yet'}
                 </span>
               </button>`;
                 })
                 .join('')}
             </form>
           </div>`;
          })()
        : ''
    }

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
        : (() => {
            // WEIGH, CHECK, THEN CLIP - and this is the screen where the first
            // two happen. An order whose return leg has not been recorded has
            // not been weighed against what we collected, so there is nothing
            // to scan into the van yet and no clip has been earned.
            //
            // The form itself lives on the order page, which is the one place
            // that records a return. Sending him there rather than repeating it
            // here is the same rule the load-out link follows: two ways to do
            // one job is how they drift.
            const waiting = (stop.orders || []).filter((o) => o.return_bag_count == null);

            // NOTHING ELSE UNTIL EVERY BAG IS IN HIS HANDS. The weighing card
            // below is the next step, and offering it while bags are still on
            // the shelf invites a load being weighed short - which is the one
            // thing the weight check exists to catch, defeated by doing it in
            // the wrong order. The tick-list above is the whole screen until it
            // is finished.
            const uncollected = (stop.finishedBags || []).filter((b) => !b.collected_at).length;
            if (uncollected) return '';

            if (waiting.length) {
              return `
           <div style="margin:0 0 18px;padding:16px 18px;border:2px solid var(--ink-900);
                       border-radius:14px;background:var(--paper-200);">
             <p class="eyebrow" style="margin:0 0 8px;">Now weigh what you picked up</p>
             <p style="font-size:15px;line-height:1.55;margin:0;">
               Everything is in your hands. Put it on their scale, order by
               order - it gets checked against what you collected from the
               customer, and only then do the clips go on.
             </p>
           </div>

           ${waiting
             .map(
               (o) => `
           <a class="btn btn-primary btn-lg btn-full" style="margin-bottom:10px;"
              href="/ops/orders/${escapeHtml(String(o.order_number))}?from=run">
             Order ${escapeHtml(String(o.order_number))}${
                 o.weight_lb ? ` - went in at ${Number(o.weight_lb).toFixed(0)} lb` : ''
               } ${icon('arrow-right', '22')}
           </a>`
             )
             .join('')}

           <p style="font-size:14px;color:var(--ink-500);line-height:1.5;margin:12px 0 0;">
             ${waiting.length === 1 ? 'One order' : `${waiting.length} orders`} still to
             weigh back in. The van scan comes after.
           </p>`;
            }

            return `
           <a class="btn btn-primary btn-lg btn-full" href="/ops/loadout">
             Scan them into the van ${icon('arrow-right', '22')}
           </a>
           <p style="font-size:14px;color:var(--ink-500);line-height:1.5;margin:12px 0 0;">
             All weighed and clipped. Every bag gets scanned out and the van is
             loaded in reverse, so stop 1 is by the door. Come back here when
             that is done.
           </p>`;
          })()
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

  // THE SCANNER SCRIPT, WITHOUT WHICH THE CAMERA BUTTON NEVER APPEARS.
  //
  // This page draws scan fields and forgot to emit the script that drives them,
  // so the button - which ships as display:none and is revealed by that script
  // - stayed hidden on every phone, including the Android ones that have had a
  // working decoder all along. It looked like a plain text box because that is
  // exactly what it was.
  //
  // The load-out page has always included it. This is the guided run, the one
  // screen a driver actually works from, and it did not.
  return `${head}
    ${progressBar(run.done, run.total)}
    ${run.arrived ? (partnerStop ? partnerCard(run) : taskCard(run)) : travelCard(run)}
  </div>
  ${scannerScript()}`;
}

module.exports = { runBody };
