'use strict';

// ---------------------------------------------------------------------------
// /ops/journey — one bag, from the doorstep to the laundromat and back.
//
// HOW THIS DIFFERS FROM /ops/process, WHICH IS THE QUESTION TO ASK BEFORE
// EDITING EITHER. They cover the same business and they are not the same page:
//
//   /ops/process  is organised BY PERSPECTIVE - what the customer does, what
//                 the driver does, what the laundromat does, the money, the
//                 AI, the technology, who can see what. It is the map of the
//                 system, and it is scoped so a driver is not sent the books.
//
//   /ops/journey  is one continuous PHYSICAL WALKTHROUGH of a single bag, in
//                 the order the steps actually happen, with the reason each
//                 guard exists. It is what you read to understand the work,
//                 or hand to somebody before their first route.
//
// So: a change to who does what goes in BOTH. A change to how the system is
// built goes in process. A change to the physical sequence goes here first.
//
// Same discipline as process.js: every figure that the running system already
// knows is read from it rather than typed, so it cannot drift. The prose can,
// which is why REVIEWED exists - correct the affected part and bump the date
// in the same commit.
// ---------------------------------------------------------------------------

const { escapeHtml: esc } = require('./layout');
const { site } = require('./site');
const { config } = require('../config');
const partners = require('../core/partners');

const REVIEWED = '3 September 2026';  // the laundromat's weight is required and
                                      // the card is charged at their weigh-in
// Previously: the drop-off in three steps; no scale photo; the pickup sequence

// A step in one of the three legs. `who` is who physically does it, which is
// the thing a reader most often wants and the thing prose is worst at keeping
// clear.
function step(title, who, body) {
  const tone = { Driver: 'jn-who-driver', Laundromat: 'jn-who-shop', Automatic: 'jn-who-auto' }[who];

  return `
  <li class="jn-step">
    <div>
      <h3>${esc(title)} <span class="jn-who ${tone}">${esc(who)}</span></h3>
      <p>${body}</p>
    </div>
  </li>`;
}

function leg(number, id, heading, lead, body) {
  return `
<section class="jn-section jn-leg-${number}" id="${id}">
  <div class="jn-leg-head">
    <div class="jn-num">${number}</div>
    <div>
      <h2>${esc(heading)}</h2>
      <p class="jn-lead">${lead}</p>
    </div>
  </div>
  ${body}
</section>`;
}

function journeyBody() {
  const minimum = `$${(config.pricing.minimumCents / 100).toFixed(0)}`;
  const tolerancePct = `${Math.round(partners.TOLERANCE_PCT * 100)}%`;
  const toleranceLb = `${partners.TOLERANCE_LB} lb`;

  return `
<style>
  .jn-wrap { display: flex; flex-direction: column; gap: 56px; max-width: 860px; }
  .jn-section { scroll-margin-top: 90px; }
  .jn-section p { max-width: 66ch; line-height: 1.65; }
  .jn-lead { font-size: 17px; line-height: 1.65; color: var(--ink-700); margin: 8px 0 0; }

  .jn-toc { display: flex; flex-wrap: wrap; gap: 8px; }
  .jn-toc a {
    font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
    font-weight: 700; text-decoration: none; color: var(--ink-900); background: var(--paper-050);
    border: 2px solid var(--ink-900); border-radius: 999px; padding: 7px 14px;
    box-shadow: var(--shadow-pop-xs);
  }
  .jn-toc a:hover { transform: translate(-2px, -2px); box-shadow: var(--shadow-pop-sm); }

  .jn-leg-head { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 20px; align-items: start; margin-bottom: 26px; }
  .jn-leg-head h2 { font-family: var(--font-display); font-weight: 900; font-size: 32px; line-height: 1.05; margin: 0; }
  .jn-num {
    width: 58px; height: 58px; border: 2px solid var(--ink-900); border-radius: 50%;
    box-shadow: var(--shadow-pop-sm); display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display); font-weight: 900; font-size: 26px; color: var(--ink-900);
  }
  .jn-leg-1 .jn-num { background: var(--suds-500); }
  .jn-leg-2 .jn-num { background: var(--lilac-500); }
  .jn-leg-3 .jn-num { background: var(--sunbeam-500); }

  ol.jn-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; counter-reset: jnstep; }
  .jn-step {
    background: var(--paper-050); border: 2px solid var(--ink-900); border-radius: 16px;
    box-shadow: var(--shadow-pop-sm); padding: 20px 24px;
    display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 16px; align-items: start;
  }
  .jn-step::before {
    counter-increment: jnstep; content: counter(jnstep);
    font-family: var(--font-mono); font-weight: 700; font-size: 14px; color: var(--ink-500);
    font-variant-numeric: tabular-nums; padding-top: 3px;
  }
  .jn-step h3 { font-family: var(--font-display); font-weight: 900; font-size: 20px; margin: 0 0 6px; line-height: 1.25; }
  .jn-step p { margin: 0; color: var(--ink-700); }

  .jn-who {
    display: inline-block; font-family: var(--font-mono); font-weight: 700; font-size: 10px;
    letter-spacing: 0.1em; text-transform: uppercase; border: 2px solid var(--ink-900);
    border-radius: 999px; padding: 2px 9px; vertical-align: 3px; white-space: nowrap;
    color: var(--ink-900);
  }
  .jn-who-driver { background: var(--suds-300); }
  .jn-who-shop { background: var(--lilac-300); }
  .jn-who-auto { background: var(--paper-200); }

  .jn-note {
    background: var(--sunbeam-500); border: 2px solid var(--ink-900); border-radius: 16px;
    box-shadow: var(--shadow-pop-sm); padding: 22px 26px; margin-top: 20px;
  }
  .jn-note h3 { font-family: var(--font-display); font-weight: 900; font-size: 20px; margin: 0 0 10px; }
  .jn-note p { margin: 0 0 12px; color: var(--ink-900); }
  .jn-note p:last-child { margin: 0; }
  .jn-stop { background: var(--stain-100); border-color: var(--stain-500); box-shadow: 4px 4px 0 var(--stain-500); }

  .jn-card {
    background: var(--paper-050); border: 2px solid var(--ink-900); border-radius: 16px;
    box-shadow: var(--shadow-pop-md); padding: 26px; margin-top: 22px;
  }
  .jn-code {
    font-family: var(--font-mono); font-weight: 700; font-size: 24px; letter-spacing: 0.14em;
    border: 2px solid var(--ink-900); border-radius: 12px; background: var(--sunbeam-500);
    display: inline-block; padding: 7px 17px; box-shadow: var(--shadow-pop-xs);
  }
  dl.jn-defs { display: grid; grid-template-columns: minmax(0, 180px) minmax(0, 1fr); gap: 11px 22px; margin: 20px 0 0; }
  dl.jn-defs dt { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-500); padding-top: 3px; }
  dl.jn-defs dd { margin: 0; font-weight: 700; }

  .jn-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 20px; }
  .jn-split > div { border: 2px solid var(--ink-900); border-radius: 14px; padding: 18px 20px; box-shadow: var(--shadow-pop-xs); }
  .jn-split h3 { font-family: var(--font-display); font-weight: 900; font-size: 18px; margin: 0 0 8px; }
  .jn-split p { margin: 0; font-size: 15px; color: var(--ink-700); }
  .jn-can { background: var(--suds-100); }
  .jn-cannot { background: var(--stain-100); }

  table.jn-tbl { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
  table.jn-tbl th {
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--ink-500); font-weight: 700; text-align: left; padding: 0 12px 10px 0;
    border-bottom: 2px solid var(--ink-900);
  }
  table.jn-tbl td { padding: 11px 12px 11px 0; border-bottom: 1px solid var(--ink-100); vertical-align: top; }
  table.jn-tbl th.c, table.jn-tbl td.c { text-align: center; }
  .jn-yes { color: var(--suds-700); font-weight: 700; }
  .jn-no { color: var(--ink-500); }
  .jn-scroll { overflow-x: auto; }
  .jn-scroll table { min-width: 520px; }

  @media (max-width: 620px) {
    .jn-split { grid-template-columns: minmax(0, 1fr); }
    dl.jn-defs { grid-template-columns: minmax(0, 1fr); gap: 4px 0; }
    dl.jn-defs dd { margin-bottom: 12px; }
    .jn-leg-head { grid-template-columns: 44px minmax(0, 1fr); gap: 14px; }
    .jn-num { width: 44px; height: 44px; font-size: 20px; }
    .jn-leg-head h2 { font-size: 26px; }
    .jn-step { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  }
</style>

<div class="jn-wrap">

  <header>
    <p class="eyebrow" style="margin:0 0 8px;">One bag, door to door</p>
    <h1 style="margin:0 0 16px;font-size:46px;line-height:1.03;">What happens to a bag.</h1>
    <p class="jn-lead" style="font-size:19px;max-width:60ch;">
      Every step from the customer's doorstep to the laundromat and back, in the
      order it happens, who does it, and why the awkward-looking rules are
      there. Read this before your first route.
    </p>
    <p style="font-family:var(--font-mono);font-size:12px;color:var(--ink-500);margin:0 0 22px;max-width:66ch;">
      Prose last checked against the code on ${esc(REVIEWED)}. Prices, the
      minimum and the tolerance are read live from the running system.
      <a href="/ops/process" style="color:var(--ink-900);">How it all works</a>
      is the same business by perspective - the customer, the money, the AI, the
      technology. This page is the physical walkthrough.
    </p>
    <nav class="jn-toc">
      <a href="#door">At the door</a>
      <a href="#choose">Choosing a laundromat</a>
      <a href="#shop">At the laundromat</a>
      <a href="#back">Back to the door</a>
      <a href="#identity">Whose laundry is whose</a>
      <a href="#texts">What the customer hears</a>
      <a href="#rules">The rules underneath</a>
    </nav>
  </header>

  ${leg(1, 'door', "At the customer's door",
    `The driver is standing outside with his hands full. Everything here is
     built around that.`,
    `
    <ol class="jn-steps">
      ${step('Drive to the stop', 'Driver',
        `His route shows <strong>one stop and one task at a time</strong>, never a
         list - reading ahead on a doorstep is how the wrong bag reaches the wrong
         house. A button opens the maps app, then he taps <strong>I'm here</strong>.`)}

      ${step('How many bags?', 'Driver',
        `The count comes first, before anything else, so the screen knows how many
         bags to walk him through. Asking for stickers before anybody has said how
         many bags there are is a question out of order.`)}

      ${step('One bag at a time: tag, scale, photo', 'Driver',
        `For each bag in turn he puts a <strong>bag tag</strong> on it, puts the bag
         on the scale and types what it says. Then the next
         bag. He is never asked for one total at the end - that makes him add up in
         his head and loses which bag was the heavy one.
         <br><br>
         <strong>A bag tag carries four numbered peelable stickers</strong>, all
         printed with the same id - 7MQ5Y2, and then -1 through -4. The id is what a
         person says out loud and it is the same on all four; the number is what
         makes them individually addressable, so a sticker tapped twice cannot be
         mistaken for a second bag.
         <br><br>
         The four are what make the return leg work. One bag we collect becomes
         however many bags the laundromat packs, and each of those gets one sticker
         off the tag it came out of - so a bag they packed carries an id without
         anybody binding a fresh code to it at a counter.`)}

      ${step('A numbered clip goes on', 'Automatic',
        `Each weighed bag gets the lowest free clip number in his van, from a real
         bag of ${config.routing.vanClips} numbered clips. A tag id identifies a bag
         perfectly and is useless shouted across a counter;
         <em>"four, six and ten"</em> is what a driver and a counter assistant can
         actually say to each other. The clips are his own - another van's clip 4
         never collides with his.`)}

      ${step('In the van', 'Driver',
        `Tapped once all of them are actually loaded. The customer gets a text.`)}

      ${step('A price is worked out, but it is not final yet', 'Automatic',
        `The bag weights are added up, multiplied by the rate stored on that order -
         never today's rate, so changing the price never re-prices work already
         quoted - and floored at the ${esc(minimum)} minimum.
         <strong>Nothing is texted and nothing is charged here.</strong> The
         laundromat weighs the same laundry when they take it in, and if their
         figure is higher that is what gets billed - so quoting ours now would be
         promising a price we might not honour.`)}
    </ol>

    <div class="jn-note jn-stop">
      <h3>No photo, no weight</h3>
      <p>
        <strong>There is no photograph of the scale.</strong> There used to be,
        and it was required: that number charges somebody's card, and 400 lb
        typed instead of 40 is a $1,000 charge. Neil's call to drop it - a photo
        step at every bag on every doorstep is real time, every day, against a
        dispute that has not happened yet.
        <br><br>
        So the weight is checked by other things instead: each bag is weighed on
        its own rather than as a pile, the laundromat weighs it again and a gap
        raises an issue, and every figure is in the order's change log with a
        name against it.
      </p>
    </div>`)}

  <section class="jn-section" id="choose">
    <p class="eyebrow" style="margin:0 0 8px;">Between the two</p>
    <h2 style="font-size:32px;line-height:1.05;margin:0 0 14px;">Which laundromat it goes to</h2>
    <p class="jn-lead" style="margin-bottom:18px;">
      Decided by the system while he drives, not by the driver at the wheel.
      Every partner is costed as <strong>the wash plus the driving out and
      back</strong>, and the cheapest all-in wins. Four things rule one out
      before that:
    </p>

    <div class="jn-scroll">
      <table class="jn-tbl">
        <thead>
          <tr><th>Ruled out when</th><th>Why</th></tr>
        </thead>
        <tbody>
          <tr><td>Shut when we would arrive</td><td>Hours are stored per weekday. A weekday with nothing entered counts as closed, because a routing decision resolves to yes or no and "we never filled it in" is not something a van can act on</td></tr>
          <tr><td>No room left today</td><td>Their daily capacity against what we have already sent them. Capacity nobody entered is unknown, not zero, and disqualifies nobody</td></tr>
          <tr><td>Past their drop-off cutoff</td><td>Some stop accepting work well before they close</td></tr>
          <tr><td>Turnaround too slow</td><td>It would miss the ${esc(site.turnaround)} promise the customer was already given</td></tr>
        </tbody>
      </table>
    </div>

    <div class="jn-note">
      <h3>The whole order goes to one laundromat</h3>
      <p>
        Splitting one customer's bags across two would mean their wash finishes at
        different times, so they either wait for the slowest bag or get delivered
        twice. The routing decision is per order; the clip is per bag.
      </p>
      <p>
        A partner at capacity is routed <em>around</em>, not blocked at - a driver
        holding a bag at a loading dock needs somewhere to put it, not an error
        message. Every partner passed over is listed with the reason, because an
        unexplained name is not a decision anybody can check.
      </p>
    </div>
  </section>

  ${leg(2, 'shop', 'At the laundromat',
    `The counter staff have no account, no login and no training. A camera
     pointed at a sticker is the entire interface.`,
    `
    <ol class="jn-steps">
      ${step('Take the bags out of the van', 'Driver',
        `He confirms each one by its van clip before anything moves. One card, one
         switch per clip, and the button underneath does nothing until every one
         of them is on.`)}

      ${step('Hand each bag over', 'Driver',
        `One bag at a time across the counter, and its clip comes off as it goes.
         A bag confirmed on its own is a bag somebody looked at.`)}

      ${step('Put the clips back in the van', 'Driver',
        `The step that closes the loop on a piece of stock we own a finite number
         of. A clip taken off a bag is in his pocket, not in the van - until he
         confirms it back, the system still counts it as out and will not put it
         on another bag. Only now is the order locked to this laundromat, so the
         drop stays on his route until the clips are home.`)}

      ${step('Scan a bag', 'Laundromat',
        `Any phone camera on the QR sticker opens a page with <strong>no sign-in at
         all</strong>. That is the point, and it is why so little is on it.`)}

      ${step('Weigh that bag and type the number', 'Laundromat',
        `They weigh each bag on their own scale and enter it. They are weighing it
         anyway for their own invoice, so asking costs them nothing. The form is not
         on the page until the driver has marked the bags dropped off, and the route
         behind it refuses too - on a page with no login, a hidden form whose route
         still fires is not a guard.`)}

      ${step('Wash, dry, fold', 'Laundromat',
        `To the five settings on the screen. A countdown shows how long is left
         before the bag is due back.`)}

      ${step('Collect it again', 'Driver',
        `He marks it ready once they have finished. The customer is deliberately
         <strong>not</strong> texted at either of these two steps.`)}
    </ol>

    <div class="jn-card">
      <p class="eyebrow" style="margin:0 0 14px;">Everything the laundromat can see</p>
      <p style="margin:0 0 4px;"><span class="jn-code">7MQ5Y2</span></p>
      <dl class="jn-defs">
        <dt>Which bag</dt><dd>Bag 2 of 3 &middot; Order #1042</dd>
        <dt>Water</dt><dd>Cold</dd>
        <dt>Detergent</dt><dd>Hypoallergenic</dd>
        <dt>Softener</dt><dd>No</dd>
        <dt>Sorting</dt><dd>Wash darks separately</dd>
        <dt>Due back</dt><dd>13h 40m left</dd>
      </dl>
    </div>

    <div class="jn-split">
      <div class="jn-can">
        <h3>They can</h3>
        <p>Read the wash settings. Enter their own weight for each bag. See how long
           they have.</p>
      </div>
      <div class="jn-cannot">
        <h3>They never see</h3>
        <p>Name, address, phone number or price. <strong>No free text of any
           kind</strong>, however laundry-ish it looks - a real saved note reads
           "deliver to 16-51 Chandler Dr", and no filter reliably catches that, so
           the page lists the fields it allows rather than trying to redact.</p>
      </div>
    </div>

    <div class="jn-note">
      <h3>Two scales decide the price. A person decides when they disagree.</h3>
      <p>
        Our driver weighs it at the door and the laundromat weighs it when they
        take it in. Once both are in:
      </p>
      <p>
        <strong>Within the tolerance</strong> - the customer is billed on the
        <strong>higher of the two</strong>, the card is charged, and they are
        texted the total. That one message is the first and only thing they are
        told about the price.
      </p>
      <p>
        <strong>Past the tolerance</strong> - everything stops. No charge, no
        text, and it goes on the issues screen until somebody settles it by hand.
        A customer told a figure we are still arguing about internally has been
        told the wrong thing, and taking the money first turns a decision into a
        refund.
      </p>
      <p>
        The tolerance is the larger of ${esc(toleranceLb)} and ${esc(tolerancePct)}
        of the load: a flat ${esc(toleranceLb)} is far too tight on a 60 lb load,
        and a flat ${esc(tolerancePct)} far too loose on a 10 lb one. It is also
        what makes reading a partner's number into a bill safe at all - a
        laundromat can move a price by less than the tolerance on their own, and
        by nothing whatever past it.
      </p>
      <p>
        <strong>They have to enter one.</strong> An order cannot be marked
        finished while a bag has no weight against it, and the page says which
        bag it is waiting on. Their number is half of what bills, so an order
        settled on one scale is an order settled on half the evidence.
      </p>
      <p>
        <strong>A bag we wash ourselves never gets here</strong>, so it has only
        our scale - delivery settles and charges that one instead. That is the
        backstop, not the normal route.
      </p>
    </div>`)}

  ${leg(3, 'back', "Back to the customer's door",
    'Where the laundry lands, and where an unpaid order is caught.',
    `
    <ol class="jn-steps">
      ${step('Weigh what he is taking, before anything moves', 'Driver',
        `He says how many finished bags there are and puts the lot on their scale.
         That weight is checked against what he collected from the customer.
         <strong>A different number of bags is normal</strong> - they repack into
         their own - so nothing is said about the count; it is the weight that is
         checked.
         <br><br>
         Short means a bag is probably still on their shelf, and the place to find
         that out is the counter he is standing at, not a doorstep two hours later.
         A refusal creates nothing at all, so he can weigh again and retry without
         undoing anything.`)}

      ${step('Then the clips go on', 'Automatic',
        `<strong>Only once the weight passes.</strong> Each bag gets the lowest free
         clip in his van, so a clipped bag is a <em>verified</em> bag and the clips
         are the record that this load was weighed and matched before it moved.
         <br><br>
         The clip attaches to the bag itself rather than to a code, so the count is
         whatever the laundromat actually packed and nobody has to scan anything to
         load the van.`)}

      ${step('An admin can take a load that did not match', 'Admin only',
        `The threshold is a guess and says so, and a laundromat closing in five
         minutes does not care. So an admin - never the driver, because the value of
         the check is that somebody other than the person in a hurry agreed - can
         push past the refusal with a reason.
         <br><br>
         It is an <em>override</em>, not a bypass. The reason goes on the order with
         a name on it, an issue is still raised for the morning, and what the driver
         is told says plainly that it did not match. Going ahead tonight is a
         decision about tonight; it is not the same as the load being right.`)}

      ${step('Load the van in reverse', 'Driver',
        `Bags load <strong>highest stop deepest</strong>, so stop 1 ends up by the
         doors. At each house the bags for that order are the ones on its clips,
         rather than a search through the van.`)}

      ${step('Out for delivery', 'Driver',
        `The customer is texted. <strong>This is refused until the return leg has
         been recorded</strong> - an order once went out, and its customer was told
         it was coming, while nobody had yet recorded what came off the laundromat's
         shelf. The first moment anybody would have found a missing bag was a
         doorstep, after the promise had already been sent.`)}

      ${step('Scan every bag at the door', 'Driver',
        `A checklist ticks the codes off one at a time. While anything on the order
         is unscanned the camera is <strong>not on the page at all</strong> - not
         greyed out, absent.`)}

      ${step('One photo', 'Driver',
        `However many bags there are, there is exactly one photo. It is a picture of
         the drop-off, not of each bag; the scans are what prove which bags they
         were.`)}

      ${step('Delivered', 'Automatic',
        `The customer is texted a link on our own domain to the photo. Every sticker
         on the order is retired at this point, so one pulled out of a bin later
         opens nothing - though the order page still shows which codes were on which
         bag.
         <strong>The card is charged here only if it was not already.</strong> Most
         orders are paid for the moment the two scales agree; this is the backstop
         for the ones where the laundromat never entered a weight. A held or
         declined order is still delivered - money is our problem, not a reason to
         stand on somebody's step holding their clothes.`)}
    </ol>

    <div class="jn-note jn-stop">
      <h3>Why the camera comes last</h3>
      <p>
        A driver who photographs the doorstep and only then finds he is holding the
        wrong bag has already done the step that means "delivered" in his head, and
        the scan becomes a formality he is motivated to get past.
      </p>
    </div>

    <div class="jn-note">
      <h3>A declined card never holds up a delivery</h3>
      <p>
        The laundry is handed over and the payment chased by text. Holding
        somebody's clothes over a decline is a bad look and legally murky; the
        exposure is one order.
      </p>
    </div>`)}

  <section class="jn-section" id="identity">
    <p class="eyebrow" style="margin:0 0 8px;">The hard part</p>
    <h2 style="font-size:32px;line-height:1.05;margin:0 0 14px;">Keeping track of whose laundry is whose</h2>
    <p class="jn-lead" style="margin-bottom:18px;">
      Two problems sit underneath this whole process, and both come from the same
      fact: <strong>a customer's laundry arrives in whatever they own</strong> - a
      trash bag, an IKEA tote, a duffel - and that bag is emptied and thrown away
      at the laundromat. "Bring any bag" is the promise, and this is what it costs
      to keep it.
    </p>

    <div class="jn-split">
      <div class="jn-cannot">
        <h3>1. Bags in is not bags out</h3>
        <p>
          The laundromat washes the <em>contents</em> and packs them into their own
          bags. Two bags in can come back as one. One can come back as three. Neither
          number predicts the other, and nobody knows the second one until the work
          is finished.
        </p>
      </div>
      <div class="jn-cannot">
        <h3>2. The dead zone</h3>
        <p>
          Every code we have is on an intake bag. The moment those bags are emptied
          and binned, the clothes are in a machine with nothing on them that says
          which order they are. That gap runs from intake to folding.
        </p>
      </div>
    </div>

    <div class="jn-note" style="margin-top:22px;">
      <h3>What answers the first one: the order, and the weight</h3>
      <p>
        <strong>The order number is the identity; bags are just containers.</strong>
        So the two legs are counted separately and never against each other. The
        bags collected are one set, the bags returned are another, and the system
        never assumes they match - a returning bag is not a spare pickup bag, and
        the check at the door asks only about the bags actually going to that door.
      </p>
      <p>
        <strong>What proves nothing was lost is the weight, not the count.</strong>
        25 lb collected and 25 lb returned means it is all there, whether it came
        back in one bag or in four. The two totals are compared under the one order
        number, using the same tolerance as the scales, and a gap raises an issue.
        It never re-prices anything - the customer was billed on a settled figure
        and a discrepancy is a question for a person.
      </p>
    </div>

    <div class="jn-note" style="margin-top:18px;">
      <h3>What answers the second one: four stickers on the tag</h3>
      <p>
        <strong>A laundromat already keeps jobs apart</strong> - through washer,
        dryer and folding table. They have to; it is the whole trade. We are not
        introducing that discipline and we should not try to replace it.
      </p>
      <p>
        The problem is narrower than it looks. It is not "how does a laundromat
        track a job" - they do that already. It is that <strong>the bag we put an
        id on is not the bag that comes back</strong>. They empty ours, wash the
        contents and pack them into their own, so at the moment of repacking the
        identity has nowhere to live.
      </p>
      <p>
        The answer is to print the identity <em>four times over</em>. A bag tag
        carries four peelable stickers, all reading the same id and each carrying
        its own number. When they pack a finished bag they peel one off and put it
        on. <strong>One bag in can become four out and every one of them still says
        which order it is</strong>, without anybody binding a fresh code to anything
        at a counter, and without us being told in advance how many bags it will
        take.
      </p>
      <p>
        Two other answers were tried on paper and dropped: a numbered plastic tag we
        lend out (our stock, in somebody else's building, relying on it being
        returned) and a sticker on the cart (a cart gets emptied into a dryer, and
        the tag is then on the wrong object).
      </p>
      <p style="border-top:2px solid var(--ink-900);padding-top:14px;">
        <strong>The clip is a separate thing and only lives in the van.</strong>
        Once the weight matches, each finished bag also gets a numbered clip, which
        is what a driver and a counter assistant can actually say out loud -
        <em>"four, six and ten"</em>. It comes off at the customer's door, so
        nothing of ours is left in somebody else's building.
      </p>
      <p>
        The sticker is what outlives the clip. A bag queried a week later still has
        an id on it, which was the open question the last time this page was
        written.
      </p>
    </div>

    <div class="jn-note" style="margin-top:18px;">
      <h3>It is a blind drop-off</h3>
      <p>
        Whatever we hand a laundromat carries the code and the order number and
        <strong>nothing else</strong>. No name, no street, no phone. The page behind
        the QR works the same way - five structured wash fields, which bag, and a
        countdown. Free text never crosses, however laundry-ish it looks, because a
        real saved note reads "deliver to 16-51 Chandler Dr".
      </p>
    </div>
  </section>

  <section class="jn-section" id="texts">
    <p class="eyebrow" style="margin:0 0 8px;">The thread</p>
    <h2 style="font-size:32px;line-height:1.05;margin:0 0 14px;">What the customer hears, and when</h2>
    <p class="jn-lead" style="margin-bottom:14px;">
      Four texts across the whole job. Two steps deliberately send nothing.
    </p>

    <div class="jn-scroll">
      <table class="jn-tbl">
        <thead>
          <tr><th>Step</th><th class="c">Texted</th><th>What it tells them</th></tr>
        </thead>
        <tbody>
          <tr><td>In the van</td><td class="c jn-yes">Yes</td><td>We have collected it</td></tr>
          <tr><td>Weighed at the door</td><td class="c jn-no">No</td><td>&mdash; the figure can still move</td></tr>
          <tr><td>Price settled</td><td class="c jn-yes">Yes</td><td>The weight, the total, and that the card has been charged</td></tr>
          <tr><td>At the laundromat</td><td class="c jn-no">No</td><td>&mdash;</td></tr>
          <tr><td>Finished washing</td><td class="c jn-no">No</td><td>&mdash;</td></tr>
          <tr><td>Out for delivery</td><td class="c jn-yes">Yes</td><td>It is on the van, coming back</td></tr>
          <tr><td>Delivered</td><td class="c jn-yes">Yes</td><td>Delivered, with a link to the doorstep photo</td></tr>
        </tbody>
      </table>
    </div>

    <div class="jn-note">
      <h3>Why the two silences</h3>
      <p>
        "Your laundry is at our partner laundromat" says something about how the
        business is run rather than about their order. Two more texts per order is
        real money and a worse complaint profile, for information nobody asked for.
        <strong>To the customer, LYNDRY washes the laundry</strong> - never mention
        a partner, a laundromat, or anywhere the work happens.
      </p>
    </div>
  </section>

  <section class="jn-section" id="rules">
    <p class="eyebrow" style="margin:0 0 8px;">Underneath all of it</p>
    <h2 style="font-size:32px;line-height:1.05;margin:0 0 18px;">The rules that are easy to break by accident</h2>

    <ol class="jn-steps">
      ${step('The partner never touches the system', 'Automatic',
        `No accounts and no logins - only the sticker page. The driver records
         everything, because the weight is what charges a card and one of ours
         belongs between that number and somebody's money. There is also no signed
         partner yet and no agreed commercial terms, so partner logins would be
         building for somebody who does not exist.`)}

      ${step('Steps cannot be skipped or repeated', 'Automatic',
        `One piece of code owns an order's status and every screen asks it. A driver
         double-tapping cannot deliver an order twice or charge for it twice; he
         gets a sentence saying so.`)}

      ${step('Every change is written down, and nothing is ever edited', 'Automatic',
        `Status moves, weights, corrections, prices, charges, which laundromat had
         it and what their scale said - what changed, when, who did it and why.
         Records are only ever added, because a log that can be tidied up afterwards
         is not evidence of anything. Recording never breaks the thing being
         recorded: a driver at a door is never stopped by the audit trail failing.`)}

      ${step('The driver screens have no JavaScript', 'Automatic',
        `On two bars of signal in a stairwell he gets a page that either worked or
         did not, rather than a spinner that lies. The camera scanner is an
         accelerator on top - every scan box is a plain text field he can type into,
         which is exactly what happens on an iPhone.`)}

      ${step('The three legs never reorder', 'Automatic',
        `Collect, visit the laundromat, deliver. You cannot drop bags you have not
         picked up, and you cannot deliver laundry you have not collected back.
         Sequencing the whole day as one problem gives a shorter route that cannot
         be driven, which is worse than a longer one that can.`)}
    </ol>
  </section>

</div>`;
}

module.exports = { journeyBody, REVIEWED };
