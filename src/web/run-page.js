'use strict';

const { escapeHtml, icon } = require('./layout');
const { scanField, scannerScript, describeCodeFormat } = require('./scanner');
const booking = require('../core/booking');
const { can } = require('../core/roles');

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

// WHAT THIS STOP IS, AND IT IS THE HEADING NOW.
//
// The address used to be the biggest thing on the card, which made the screen
// read as "go to this address" when the driver's job is "PICK UP AN ORDER at
// this address". He already knows he is driving somewhere; what he needs at a
// glance is which of four quite different jobs this stop is.
//
// A CLOSED SET OF TASK NAMES, deliberately. Four kinds of stop, four verbs, and
// they read the same every time - so the shape of the sentence is recognisable
// before the words are, which is what makes it a one-second read rather than a
// one-second parse.
const HEADLINE = {
  collect: 'Pick up order',
  deliver: 'Deliver order',
  dropoff: 'Drop at laundromat',
  pickup_partner: 'Pick up from laundromat',
};

// THE TASK, WITH THE ORDER NUMBER INSIDE IT.
//
// Neil's layout, said twice: a section clearly marked TASK, and the task itself
// reads "Pick up order #1940". The number is part of that sentence rather than
// a separate label floating above it - a driver reading the card out loud says
// "pick up order nineteen forty", which is one thought, not two.
//
// Written once and used by both cards, because the travel card and the task
// card are the same stop a minute apart: he taps "I'm here" and one becomes the
// other. Two ways of writing the order number is two things to keep in step.
//
// THE NUMBER IS THE LINK, and only for somebody who may follow it: behind it
// are the customer's name, their thread and the money, none of which a driver
// is shown. Sales never has orders.drive, so on this screen that is Admin and
// nobody else.
function taskLine(text, stop, user, lead = '', tail = '', mid = '') {
  const quiet = 'font-weight:400;color:var(--ink-500);';
  const order = stop.order || null;

  if (!order) {
    // A laundromat visit is several orders at one door. Naming one of them
    // would be picking a bag out of the load at random, so it says how many.
    const many = (stop.orders || []).length;
    return many
      ? `${escapeHtml(text)}${mid} <span style="${quiet}">${many} order${many === 1 ? '' : 's'}</span>`
      : `${escapeHtml(text)}${mid}`;
  }

  const num = `#${escapeHtml(order.order_number)}`;
  const inner = can(user, 'customers.view')
    ? `<a href="/ops/orders/${escapeHtml(order.order_number)}" style="color:inherit;">${num}</a>`
    : num;

  // "Pick up order #1940" already has the word in it; "Collect the bags" does
  // not, and "Collect the bags #1940" reads like a typo. So the caller says how
  // its own sentence joins up.
  //
  // AND SOME SENTENCES CARRY ON PAST THE NUMBER. "Put a bag tag on bag 1 for
  // order #1940 & scan the QR code on the bag tag" - Neil's wording, and the
  // order reference sits in the middle of it, so a tail is the only way to get
  // it there without the number landing at the end of a clause it does not
  // belong to.
  return `${escapeHtml(text)}${mid} <span style="${quiet}">${
    lead ? `${escapeHtml(lead)} ` : ''
  }${inner}</span>${tail}`;
}

// "TASK: Pick up order #1940" - the label, a colon, then the value beside it.
// Neil's format to the letter, given three times and finally spelled out. The
// label does not shrink when the value wraps, so a long address stays lined up
// under itself rather than under the word WHERE.
function stopLine(label, value, extra = '') {
  return `
    <p class="stop-line${extra ? ` ${extra}` : ''}">
      <span class="eyebrow">${escapeHtml(label)}:</span>
      <span class="stop-value">${value}</span>
    </p>`;
}

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
function travelCard(run, user = null) {
  const stop = run.current;

  // A laundromat has a name; a customer's door has only an address. Either way
  // the TASK is the heading and the place is underneath it.
  // ONE LINE. Neil's call. It was split at the first comma so the town could sit
  // under the street; he wants it read as an address, not as a shape.
  const place = [stop.name, stop.address].filter(Boolean).join(', ');

  return `
  <div style="${CARD}">
    ${stopLine('Task', taskLine(HEADLINE[stop.kind] || 'Next stop', stop, user), 'stop-line-plain')}
    ${stopLine('Where', place ? escapeHtml(place) : 'Somewhere with no address', 'stop-line-plain')}
    ${
      stop.eta
        ? // THE THIRD LABELLED LINE, same as the two above it - Neil's format
          // carried through rather than a sentence sitting under them.
          //
          // TWELVE HOUR, like every other time on this system. The ETA is
          // stored as 24-hour "18:10" and was printed raw, so the one screen a
          // driver reads at a doorstep was the only one saying 18:10 while the
          // window above it said 4-6pm. booking.readableTime is what the
          // customer's confirmation uses, so there is one way a time is
          // written.
          stopLine(
            'Due',
            escapeHtml(booking.readableTime(stop.eta) || stop.eta),
            'stop-line-plain'
          )
        : ''
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
           </form>`
        : ''
    }
  </div>`;
}

// WHAT THE TASK LINE SAYS AFTER THE ORDER NUMBER, as markup.
//
// The weigh step names the tag on the bag about to go on the scale, and the id
// is a link to that sticker's own page - Neil asked for it by URL. run.js
// supplies the words for the steps that only need words; a link is markup, so
// it is assembled here rather than in core.
function taskParts(task) {
  if (!task) return { mid: '', tail: '.' };

  // The three per-bag steps that happen with the bag in his hands. Each names
  // the tag on it, so "bag 1" is never the only way to tell two bags apart.
  const perBag = /^(weigh|clip|load)_/.test(task.key);
  const code = perBag && task.label ? task.label.code : null;

  // AN ASIDE, IN BRACKETS, BEFORE THE ORDER. Neil's arrangement: "Put Van Clip
  // 1 on Bag 1 (Tag ID 6ZP4DN) for Order #1940." The sentence is about the bag
  // in his hands, the tag says which bag it is, and the order is what all of it
  // belongs to - so the order reference ends the sentence rather than sitting
  // in the middle of it.
  const mid = code
    ? ` (Tag ID <a href="/ops/labels/${encodeURIComponent(code)}"
        style="color:inherit;">${escapeHtml(code)}</a>)`
    : '';

  // A few steps carry on past the order instead of stopping there.
  const tail = task.titleTail ? ` ${escapeHtml(task.titleTail)}` : '.';

  return { mid, tail };
}

// The one thing to do, now he is there.
function taskCard(run, user = null) {
  const stop = run.current;
  const task = run.task;
  const order = stop.order;

  // WHICH ORDER, AND WHICH CLIPS. "Deliver order 1003, clips 4, 6, 7 and 10" is
  // something a driver can act on with his hands full; four sticker codes are
  // not. Only on a delivery - on a pickup the bags do not have clips yet, the
  // screen is about to tell him which ones to put on.
  const clips = stop.kind === 'deliver' ? stop.clips || [] : [];

  // WHERE THE CUSTOMER SAID THE BAGS GO, in the slot the travel card uses for
  // the address - large, bold, directly under the task. It is the one fact that
  // decides what he does with his hands next, and it was not on this screen at
  // all: he arrived at a door knowing only the number of the house.
  //
  // Only the two door steps carry it. On the tag, weigh, clip and load steps
  // the bag is already in his hands and repeating it would be furniture.
  const where =
    task && task.spot
      ? stopLine('Where', escapeHtml(task.spot), 'stop-line-plain')
      : '<div style="height:6px;"></div>';

  // THE SAME TWO LABELLED LINES AS THE CARD BEFORE IT. He taps "I'm here" and
  // this replaces the travel card, so TASK and WHERE stay in the same places
  // and only their values change.
  const header = `
    ${stopLine(
      'Task',
      (() => {
        const { mid, tail } = taskParts(task);
        return taskLine(task ? task.title : 'All done here', stop, user, 'for Order', tail, mid);
      })(),
      'stop-line-plain'
    )}
    ${where}
    ${
      clips.length
        ? `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;">
             clip${clips.length === 1 ? '' : 's'}
             <strong style="font-family:var(--font-mono);">${clips.join(', ')}</strong>
           </p>`
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
    ${
      // ONE SUPPORTING LINE, IN ONE PLACE. Every step used to print this above
      // the control AND again as a hint below it - on the collect step, the
      // same sentence word for word, which is the line Neil deleted.
      task && task.detail
        ? `<p style="font-size:14px;color:var(--ink-500);line-height:1.5;margin:12px 0 0;">
             ${escapeHtml(task.detail)}
           </p>`
        : ''
    }
    ${ticks}
    <p style="font-size:13px;color:var(--ink-500);line-height:1.5;margin:18px 0 0;">
      ${escapeHtml(stop.address || '')}
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
             inputmode="numeric" required autofocus placeholder="1" style="width:100%;margin-bottom:16px;">
      <button type="submit" class="btn btn-primary btn-lg btn-full">That's how many</button>
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
      })}`;
  }

  if (task.key.startsWith('weigh_')) {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/bag-weight${back}"
          enctype="multipart/form-data" style="margin:0;">
      <input type="hidden" name="code" value="${escapeHtml(task.label.code)}">

      <label class="field-label" for="weight_lb">What does bag ${task.position} weigh?</label>
      <input class="input input-lg" type="number" id="weight_lb" name="weight_lb"
             step="0.01" min="0.01" max="200" inputmode="decimal" required autofocus
             placeholder="12.5" style="width:100%;margin-bottom:16px;">

      <button type="submit" class="btn btn-primary btn-lg btn-full">Save bag ${task.position}</button>
    </form>`;
  }

  // ONE BAG INTO THE VAN, confirmed. The last of the four steps that belong to
  // a single bag - tag, weigh, clip, load - so the driver finishes the bag in
  // his hands before picking up the next one.
  if (task.key.startsWith('load_')) {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/bag-van${back}" style="margin:0;">
      <input type="hidden" name="code" value="${escapeHtml((task.label || {}).code || '')}">

      <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
        Bag ${escapeHtml(task.position)}${
          task.clip != null ? `, on clip <strong>${escapeHtml(task.clip)}</strong>` : ''
        }, into the van.
      </p>

      <button type="submit" class="btn btn-primary btn-lg btn-full">
        Bag ${escapeHtml(task.position)} is in the van
      </button>
    </form>`;
  }

  // ONE BAG, ONE CLIP, ONE CONFIRMATION. Neil asked for this by name: he was
  // never told to put a clip on anything, because the number was assigned at
  // the scale and only mentioned in a list at the very end.
  //
  // The number is the whole content of the screen. It is what he reads off,
  // what he picks out of the bag of clips, and what he will say out loud at a
  // laundromat counter, so it is set at the size of the thing you act on.
  if (task.key.startsWith('clip_')) {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/bag-clip${back}"
          class="clip-form" style="margin:0;">
      <input type="hidden" name="code" value="${escapeHtml((task.label || {}).code || '')}">

      <!-- THE NUMBER IS THE THING HE ACTS ON, so it is the control. He taps it
           to say that clip is out of the bag and in his hand - yellow to green,
           NOT IN USE to IN USE - and the confirmation underneath does not work
           until he has. Two deliberate acts, because the clip is the only thing
           that finds this bag again.

           A plain checkbox marked required: the browser refuses the submit on
           its own, with no script, which is what a driver on two bars in a
           stairwell needs. -->
      <label class="clip-toggle" style="margin:0 0 18px;">
        <input type="checkbox" name="clip_in_hand" required>
        <span class="clip-number">Van Clip #${escapeHtml(task.clip)}</span>
        <span class="clip-state">
          <span class="clip-state-off">Not in use</span>
          <span class="clip-state-on">In use</span>
        </span>
      </label>

      <button type="submit" class="btn btn-primary btn-lg btn-full">
        Clip ${escapeHtml(task.clip)} is on it
      </button>
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
    </form>`;
  }

  if (task.key === 'clips') {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/clips-off${back}" style="margin:0;">
      ${
        (task.clips || []).length
          ? `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;">
               ${task.clips
                 .map(
                   (n) => `<span style="min-width:58px;padding:12px 16px;border:2px solid var(--ink-900);
                                        border-radius:12px;background:var(--sunbeam-500);text-align:center;
                                        font-family:var(--font-mono);font-weight:700;font-size:26px;">${n}</span>`
                 )
                 .join('')}
             </div>`
          : ''
      }
      <button type="submit" class="btn btn-primary btn-lg btn-full">Out of the van, clips off</button>
    </form>`;
  }

  if (task.key === 'strip') {
    return `
    <form method="post" action="/ops/orders/${order.order_number}/strip${back}" style="margin:0;">
      <button type="submit" class="btn btn-primary btn-lg btn-full">Tags are off</button>
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
    <h2 style="font-family:var(--font-display);font-weight:900;font-size:28px;line-height:1.12;margin:0 0 8px;">
      ${escapeHtml(stop.name || 'The laundromat')}
    </h2>

    <!-- THE TASK, NOT THE ADDRESS, IS THE SECOND LINE. Neil: "it should have
         bold underneath instead of the address - pick up this number of bags,
         and have the number highlighted, because that's the task."
         He is already standing there. The address is how he got here; the
         count is what he is about to do, so it takes the weight and the
         address drops to a reference line under it. -->
    <p style="font-family:var(--font-display);font-weight:900;font-size:22px;
              line-height:1.2;margin:0 0 6px;">
      ${dropping ? 'Hand over' : 'Pick up'}
      <span style="background:var(--sunbeam-500);padding:1px 8px;border:2px solid var(--ink-900);
                   border-radius:8px;">${stop.bags}</span>
      bag${stop.bags === 1 ? '' : 's'}${
        // NO POUNDAGE ON A COLLECT STOP. That figure is what went IN - the
        // customer's dirty weight - and printing it beside bags he is picking
        // up invites him to check one against the other, which is the weighing
        // this stop deliberately no longer does.
        dropping && stop.pounds ? `, ${stop.pounds.toFixed(0)} lb` : ''
      }
    </p>

    <p style="font-size:15px;color:var(--ink-700);line-height:1.5;margin:0 0 16px;">
      ${escapeHtml(stop.address || '')}
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
             <!-- The count moved UP to sit under the laundromat's name, where
                  Neil wanted it. Repeating it here as well would be the same
                  number twice on one card. -->
             <p class="eyebrow" style="margin:0 0 4px;">Pick these up</p>
             <p style="font-size:15px;line-height:1.5;margin:0 0 14px;">
               ${
                 left
                   ? `Tap each one as they hand it to you. <strong data-left="${left}">${left} still to go.</strong>`
                   : 'All of them are ticked.'
               }
             </p>

             <form method="post" action="/ops/run/collected" data-quick
                   style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
               ${bags
                 .map((b) => {
                   const got = Boolean(b.collected_at);
                   return `
               <button type="submit" name="label_id" value="${escapeHtml(b.id)}"
                       data-got="${got ? '1' : '0'}"
                       style="width:100%;padding:14px 10px;border:2px solid var(--ink-900);
                              border-radius:12px;box-shadow:var(--shadow-pop-xs);cursor:pointer;
                              background:${got ? 'var(--suds-500)' : 'var(--paper-000)'};">
                 <span style="display:block;font-family:var(--font-mono);font-weight:700;font-size:16px;">
                   ${escapeHtml(b.code)}${b.sticker_seq ? `-${b.sticker_seq}` : ''}
                 </span>
                 <span data-state style="display:block;font-family:var(--font-mono);font-size:11px;letter-spacing:0.07em;
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
      // NOT DROPPING: just show what is coming back. There is nothing to tick
      // off here - the collecting is done bag by bag on the panel above.
      !dropping && (stop.clips || []).length
        ? `<div style="margin:0 0 22px;padding:16px 18px;border:2px solid var(--ink-900);border-radius:14px;
                      background:var(--sunbeam-500);">
             <p class="eyebrow" style="margin:0 0 10px;">Bringing back</p>
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
               These are what you are collecting.
             </p>
           </div>`
        : ''
    }

    ${
      dropping
        ? // ONE FORM, so ticking the clips gates the button that ends the stop.
          //
          // NEIL'S CHANGE: the numbers used to be a poster - here are three
          // clips, now tap "handed over all of them". He wanted each clip taken
          // off deliberately, one at a time, and only then the button.
          //
          // IT IS CHECKBOXES AND CSS, NOT JAVASCRIPT. `required` on every box
          // means the browser itself refuses to submit until all of them are
          // ticked, and says which one is missing - no script, no disabled
          // button that a driver taps and taps. This screen is used in a
          // stairwell on two bars, and CLAUDE.md is explicit that a control
          // which needs a script to work is a control that can fail to work.
          `<form method="post" action="/ops/run/dropped" style="margin:0;">
             <input type="hidden" name="partner_id" value="${escapeHtml((stop.partner || {}).id || '')}">
             ${(stop.orders || [])
               .map((o) => `<input type="hidden" name="order_id" value="${escapeHtml(o.id)}">`)
               .join('')}

             ${
               (stop.clips || []).length
                 ? `<div style="margin:0 0 22px;padding:16px 18px;border:2px solid var(--ink-900);
                                border-radius:14px;background:var(--sunbeam-500);">
                      <p class="eyebrow" style="margin:0 0 10px;">Hand over these van clips</p>
                      <div style="display:flex;flex-wrap:wrap;gap:10px;">
                        ${(stop.clips || [])
                          .map(
                            (n) => `
                        <label class="clip-tick">
                          <input type="checkbox" name="clip" value="${escapeHtml(n)}" required>
                          <span>${escapeHtml(n)}</span>
                        </label>`
                          )
                          .join('')}
                      </div>
                      <p style="margin:12px 0 0;font-size:14px;line-height:1.5;">
                        Take each clip off as you hand the bag over and tap its
                        number. Those numbers go back in the van for the next bags.
                      </p>
                    </div>`
                 : ''
             }

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
            // NO WEIGHING AT THIS STOP, and no order numbers either. Neil's
            // call: he is picking bags off a counter for this route, and which
            // order each belongs to is the sticker's business, not his.
            //
            // WHAT REPLACED THE WEIGHT CHECK, because something had to. The old
            // rule was weigh-check-clip: compare what came back against what we
            // collected, on the grounds that the WEIGHT proves nothing was left
            // behind and a count cannot. That was true when the bags coming
            // back were anonymous.
            //
            // They are not any more. Every bag the laundromat packed carries a
            // numbered sticker, it is listed here by name, and the driver ticks
            // each one as it reaches his hands. A bag left on their shelf is an
            // untapped button on this screen. That is a stronger check than a
            // total, not a weaker one - it does not just say something is
            // missing, it says which.
            const uncollected = (stop.finishedBags || []).filter((b) => !b.collected_at).length;

            const orderIds = [...new Set((stop.orders || []).map((o) => o.id))];
            const unconfirmed = (stop.orders || []).filter((o) => o.return_bag_count == null);

            if (unconfirmed.length) {
              // THE BUTTON IS THERE FROM THE MOMENT THE PAGE LOADS. Neil: "it
              // should not be hidden when the page loads, it shouldn't have to
              // wait for me to tap collected on both bags."
              //
              // It used to appear only once every bag was ticked, which meant a
              // driver had no idea the step existed until he had done the one
              // before it - and a screen that grows a new button underneath
              // your thumb is worse than one that was always honest about what
              // is coming.
              //
              // Tapping it early is refused BY THE SERVER, which names the bags
              // that are not ticked. The check was always there; what was
              // missing was somebody being told.
              //
              // THE LABEL IS STATIC. "All 2 bags are collected" changed under
              // the driver as he tapped, so the thing he was reading and the
              // thing he was about to press were not the same sentence twice
              // running.
              return `
           <form method="post" action="/ops/run/collected-all" style="margin:0;">
             ${orderIds
               .map((id) => `<input type="hidden" name="order_id" value="${escapeHtml(id)}">`)
               .join('')}
             <button type="submit" class="btn btn-primary btn-lg btn-full">
               All bags are collected
             </button>
             <p style="font-size:14px;color:var(--ink-500);line-height:1.5;margin:12px 0 0;">
               ${
                 uncollected
                   ? `Tick all ${(stop.finishedBags || []).length} above first, then tap this.`
                   : 'Tap that once they are all in the van. The van scan comes after.'
               }
             </p>
           </form>`;
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

function runBody({ run, notice = null, problem = null, user = null }) {
  const banner = (text, background, colour = 'var(--ink-900)') => `
    <p style="margin:0 0 20px;padding:14px 17px;border:2px solid var(--ink-900);border-radius:12px;
              background:${background};color:${colour};font-size:15px;line-height:1.5;font-weight:600;">
      ${escapeHtml(text)}
    </p>`;

  const head = `
  <div style="max-width:560px;margin:0 auto;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:18px;flex-wrap:wrap;">
      <h1 style="font-family:var(--font-display);font-weight:900;font-size:32px;line-height:1;margin:0;">
        Your route
      </h1>
      <a href="/ops" style="font-size:15px;font-weight:600;">All orders</a>
    </div>

    ${roundCards(run)}

    ${problem ? banner(problem, 'var(--stain-500)', 'var(--paper-050)') : ''}
    ${notice ? banner(notice, 'var(--suds-300)') : ''}`;

  if (!run.total) {
    return `${head}
    <div style="${CARD}">
      <!-- IT SAYS WHAT IS EMPTY, AND THAT IS NOT THE SAME AS THE DAY BEING
           EMPTY. Neil had two pickups booked for 2pm and this page told him
           "nothing on today" at half past twelve, which was simply untrue - the
           route he was standing in was empty, the day was not. A screen that
           tells a driver he has finished when he has not is the worst thing
           this page can do. -->
      <h2 style="font-family:var(--font-display);font-weight:900;font-size:26px;line-height:1.15;margin:0 0 10px;">
        ${
          (run.routes || []).some((r) => r.count)
            ? 'Nothing in this route'
            : 'Nothing on today'
        }
      </h2>
      <p style="font-size:16px;line-height:1.6;color:var(--ink-700);margin:0;">
        ${
          (run.routes || []).some((r) => r.count)
            ? `The rest of the day is up there - tap a route with pickups in it.`
            : `No pickups booked to you and nothing in the van. If that looks wrong,
               check the <a href="/ops">orders board</a> - an order with no driver on it
               will not appear here.`
        }
      </p>
    </div>
  </div>`;
  }

  if (run.finished) {
    return `${head}
    ${progressBar(run.done, run.total)}
    <div style="${CARD}background:var(--suds-300);">
      <h2 style="font-family:var(--font-display);font-weight:900;font-size:28px;line-height:1.15;margin:0 0 10px;">
        That's the route.
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
    ${run.arrived ? (partnerStop ? partnerCard(run) : taskCard(run, user)) : travelCard(run, user)}
  </div>
  ${scannerScript()}
  ${returnFromMapsScript()}
  ${quickTapScript()}`;
}


// ---------------------------------------------------------------------------
// THE DAY, AS CARDS YOU TAP.
//
// NEIL'S DESIGN: one card per pickup window, tap one and the tasks below are
// that window's. Work through them to the end and it is done; tap the next.
//
// EVERY WINDOW APPEARS, including the ones with nothing in them. A slot with no
// pickups is a fact about the day, and hiding it makes the day look shorter
// than it is - a driver counting three cards cannot tell whether that is the
// shape of the day or the shape of what is left.
//
// A ROUTE STAYS OPEN UNTIL ITS WORK IS DONE, not until its clock runs out.
// Neil: "a time slot appears until it's fully completed". Two uncollected bags
// at half past two are still the 12 to 2 route - the clock moving collects
// nobody's laundry - so a route with work left in it is still tappable and
// still says so.
// ---------------------------------------------------------------------------
function roundCards(run) {
  const routes = run.routes || [];

  // How much of TODAY is finished, which is what decides whether a route's
  // count reads as a total or as what is left.
  const done = Number(run.done) || 0;
  if (!routes.length) return '';

  const card = (r) => {
    // Done is not the same as past. A window whose time has gone with bags
    // still in it is LATE, and it has to look different from one that was
    // worked through, or the two read as the same thing.
    const late = r.state === 'past' && !r.complete;
    const worked = r.state === 'past' && r.complete;

    // Only the colours are inline. The box - five equal cells on one line, and
    // the type sizes that keep them on it - is .run-route in lyndry.css, per
    // the rule about inline grid styles beating the media queries.
    const style = late
      ? 'background:var(--stain-500);color:var(--paper-050);border-color:var(--ink-900);box-shadow:var(--shadow-pop-xs);'
      : r.state === 'now'
        ? 'background:var(--suds-500);border-color:var(--ink-900);box-shadow:var(--shadow-pop-xs);'
        : worked
          ? 'background:var(--paper-200);border-color:var(--ink-300);color:var(--ink-500);'
          : 'background:var(--paper-050);border-color:var(--ink-300);color:var(--ink-500);';

    // "10am-12pm", not "10am and 12pm". Five of these share one line on a
    // phone, so the words have to be as short as they can be while still
    // naming the route.
    const when = String(r.label).replace(' and ', '-');

    // STOPS, NOT PICKUPS. A laundromat visit is a stop on the route and a
    // delivery is a stop on the route; calling them all pickups made the word
    // wrong on exactly the route somebody is standing in.
    // "2 STOPS" BESIDE "STOP 2 OF 3" READS AS A CONTRADICTION, and Neil asked
    // what it meant. They answer different questions - the card is what is
    // LEFT on this route, the bar is progress through everything today
    // including what is already finished - and both are right, which is
    // exactly why the words have to say which is which.
    //
    // So the card says "left" the moment anything on the day is done. Before
    // that, "2 stops" and "stop 1 of 2" agree and the plainer word is better.
    const started = r.state === 'now' && done > 0;

    const note = late
      ? `${r.count} waiting`
      : r.count === 0
        ? 'nothing'
        : worked
          ? `${r.count} done`
          : started
            ? `${r.count} left`
            : `${r.count} ${r.count === 1 ? 'stop' : 'stops'}`;

    const inner =
      `<div class="rr-when">${escapeHtml(when)}</div>` +
      `<div class="rr-what" style="font-weight:${r.state === 'now' || late ? '700' : '400'};">${escapeHtml(note)}</div>`;

    // AN EMPTY ROUTE IS NOT A LINK. There is nothing behind it, and a card that
    // opens onto "nothing here" teaches you to stop tapping the cards.
    return r.count === 0
      ? `<div class="run-route" style="${style}">${inner}</div>`
      : `<a class="run-route" href="/ops/run?route=${encodeURIComponent(r.start)}" style="${style}">${inner}</a>`;
  };

  const now = routes.find((r) => r.state === 'now');

  return `
    <div style="margin:0 0 22px;">
      <div class="eyebrow" style="margin:0 0 9px;">
        ${now ? `On the ${escapeHtml(now.label)} route` : "Today's routes"}
      </div>
      <div class="run-routes">${routes.map(card).join('')}</div>
    </div>`;
}


// ---------------------------------------------------------------------------
// COMING BACK FROM THE MAPS APP.
//
// Neil tapped "Take me there", Apple Maps opened, and when he switched back the
// page still said "Take me there" with the button drawn half-dead. The server
// had done its job - navigating_at was recorded the moment the link was
// followed - but he was looking at a page rendered BEFORE that happened.
//
// TWO WAYS IOS GIVES YOU A STALE PAGE, and it takes both to cover them:
//
//   - the tab is restored from the back-forward cache, which fires pageshow
//     with persisted set. no-store does not reliably keep Safari out of it.
//   - the tab never unloaded at all. The maps: link was handed straight to the
//     Maps app, so switching back is a visibility change and nothing else -
//     no pageshow, no load, the same live DOM from ten minutes ago.
//
// So it watches for both, and only after the driver has actually tapped the
// directions. sessionStorage rather than a variable because a bfcache restore
// may or may not keep the variable, and a flag that survives either way is one
// less thing to reason about on a doorstep.
//
// IT IS AN ENHANCEMENT AND FAILS SAFE. With no JavaScript the page behaves
// exactly as it does today - the driver pulls to refresh - which is why this is
// a reload rather than anything that draws the screen itself. Nothing here
// decides what a stop is or what is next; it asks the server again.
// ---------------------------------------------------------------------------
function returnFromMapsScript() {
  return `
<script>
(function () {
  var KEY = 'lyndry:wentToMaps';

  // Tapping the directions link is what arms it.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href*="/ops/run/going/"]');
    if (a) { try { sessionStorage.setItem(KEY, '1'); } catch (err) {} }
  });

  function armed() {
    try { return sessionStorage.getItem(KEY) === '1'; } catch (err) { return false; }
  }

  function refresh() {
    try { sessionStorage.removeItem(KEY); } catch (err) {}
    // replace(), not reload(), so the maps hop does not pile up in history and
    // a back gesture does not re-fire the redirect to the Maps app.
    window.location.replace(window.location.pathname + window.location.search);
  }

  window.addEventListener('pageshow', function (e) {
    var backForward = false;
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      backForward = nav && nav.type === 'back_forward';
    } catch (err) {}
    if ((e.persisted || backForward) && armed()) refresh();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && armed()) refresh();
  });
})();
</script>`;
}



// ---------------------------------------------------------------------------
// TICKING BAGS OFF WITHOUT WAITING FOR THE PAGE.
//
// Neil, at a counter with seven bags: "when I tap on the link on my iPhone it
// takes a really long time for it to register." Each tap was a form post, a
// redirect and a full re-render - three network hops and a page rebuild before
// the button changed colour. On cellular that is seconds, per bag, while
// somebody is handing you laundry.
//
// The button now flips IMMEDIATELY and the post goes in the background. The
// server is still the only thing that decides anything: if the request fails
// the button flips back and says so, and the next page load shows the truth
// either way.
//
// FAILS SAFE. With no JavaScript these are ordinary submit buttons in an
// ordinary form and behave exactly as they did - which is the promise this
// screen makes, because it is used in a basement on two bars.
//
// The LAST tap does a real reload on purpose: collecting the final bag is what
// reveals the next control, and that is the server's decision to make, not a
// guess made in the browser.
// ---------------------------------------------------------------------------
function quickTapScript() {
  return `
<script>
(function () {
  var form = document.querySelector('form[data-quick]');
  if (!form || !window.fetch) return;

  var counter = document.querySelector('[data-left]');

  form.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('button[name="label_id"]');
    if (!btn || btn.disabled) return;

    e.preventDefault();

    var wasGot = btn.getAttribute('data-got') === '1';
    var left = counter ? Number(counter.getAttribute('data-left')) : null;

    // THE LAST BAG USED TO CALL form.submit() HERE, AND THAT IS WHY IT COULD
    // NOT BE TAPPED.
    //
    // form.submit() does not send the submit button's name and value - only a
    // real click does. So the last tap posted an empty body, the route found no
    // label_id, redirected, and the page came back looking identical. Neil:
    // "it's only letting us click one at a time."
    //
    // Everything goes through fetch now, carrying the value explicitly. What
    // the last one still needs is a RELOAD afterwards, because collecting the
    // final bag is what reveals the next control and that is the server's call
    // to make, not a guess in the browser.
    var isLast = !wasGot && left === 1;

    var paint = function (got) {
      btn.setAttribute('data-got', got ? '1' : '0');
      btn.style.background = got ? 'var(--suds-500)' : 'var(--paper-000)';
      var label = btn.querySelector('[data-state]');
      if (label) label.textContent = got ? 'Collected' : 'Not yet';
      if (counter && left !== null) {
        var now = left + (got ? -1 : 1);
        counter.setAttribute('data-left', now);
        counter.textContent = now + ' still to go.';
        left = now;
      }
    };

    paint(!wasGot);
    btn.disabled = true;

    var body = new URLSearchParams();
    body.set('label_id', btn.value);

    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      credentials: 'same-origin',
      redirect: 'follow',
    })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        // That was the last one, so ask the server what comes next rather than
        // drawing it here.
        if (isLast) window.location.replace(window.location.pathname + window.location.search);
      })
      .catch(function () {
        // Put it back. A bag that looks collected and is not is how one gets
        // left on a counter.
        paint(wasGot);
        btn.disabled = false;
        alert('That did not save. Check your signal and tap it again.');
      })
      .then(function () {
        // Not re-enabled after the last one: the page is on its way to
        // reloading, and a button that comes back alive for half a second
        // invites a second tap that lands on a page about to be replaced.
        if (!isLast) btn.disabled = false;
      });
  });
})();
</script>`;
}


module.exports = { runBody };
