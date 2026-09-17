'use strict';
const format = require('../core/format');

// ---------------------------------------------------------------------------
// THE ORDER PAGE AS A WAREHOUSE TERMINAL.
//
// Neil, 13 September: "The back office should look like a warehouse terminal:
// one header, one exception line, then tables."
//
// This renders /ops/orders/:id. It is a presentation and information-
// architecture change and nothing else: every button posts to a route that
// already existed, every number comes from a row that already existed, and the
// append-only history is filtered and grouped here but never rewritten.
//
// THREE THINGS IT DOES NOT CHANGE, AND WHY THEY ARE STATED AT THE TOP.
//
//   1. WHO SEES WHAT. A driver is shown the stop, not the customer - no name
//      in the heading, no phone, no thread, no money, no change log. The route
//      passes the same four permission answers it always has, and every block
//      here is gated on them. A spec that says "title with the customer name"
//      still means "for somebody allowed to see it".
//
//   2. NO JAVASCRIPT. This is the page a driver reads on two bars of signal in a
//      stairwell. The log filters are links carrying ?log=, not radio buttons
//      with a script behind them. Same result, and it works with scripting off.
//
//   3. WHICH BUTTONS EXIST. The state-aware toolbar does not carry its own table
//      of status -> button. run.js already decides which task is current for
//      the driver's screen; this page renders a control for the same task, so
//      the two front doors cannot drift. The spec's state table is the
//      acceptance test for that, not a second implementation of it.
//
// The pure helpers at the top - humanEvents, chargeRows, bagRows,
// messagesForOrder, exceptionFor, actionsFor - take rows in and hand a shape
// out, and test/order-console.test.js pins them against order #1992.
// ---------------------------------------------------------------------------

const { escapeHtml, CSS_BASE } = require('./layout');
const booking = require('../core/booking');
const payments = require('../core/payments');
const orders = require('../core/orders');
const partnersCore = require('../core/partners');
const tags = require('../core/tags');
const { scanField } = require('./scanner');

const NJ = 'America/New_York';


// "09/07/2026 - 10:31" from an ISO timestamp, in the timezone the vans drive
// in. It used to be "7 Sep 10:31", assembled by hand; the date half now goes
// through the one owner so the order console cannot disagree with the board it
// was opened from. See src/core/format.js.
function stamp(iso) {
  return iso ? format.displayDateTime(iso, { empty: '', hour12: false }) : '';
}

// The clock only, for a column that already says which day it is.
function clock(iso) {
  return iso ? format.displayTime(iso, { empty: '', hour12: false }) : '';
}

function lb(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtLb(value) {
  const n = lb(value);
  return n == null ? '—' : n.toFixed(1);
}

// ---------------------------------------------------------------------------
// THE LOG, THREE WAYS.
//
// The store is append-only and is not touched. What changes is which rows a
// person is shown by default. #1992 carries 47 events; ten of them are what a
// human means by "what happened", and the rest are the clips going on and off
// and a laundromat's sticker being scanned - true, kept, and noise.
//
// Rows are matched on what they SAY rather than on kind alone, because LABEL
// covers both "Label 0H7Y2S put on bag 1" (human) and "Van clip 2 on 0H7Y2S-1"
// (hardware). Matching on summary text is fragile in principle; in practice the
// summaries are written in code, in one place each, and a test pins the ones
// that matter.
// ---------------------------------------------------------------------------

// "Label 0H7Y2S put on bag 1" is the tag being bound - the mechanism, not the
// story. "Moved to in process" is the pickup; the Bags table says which codes.
const HUMAN_LABEL = [/ collected from the laundromat/i];

function isHuman(e, prev = null) {
  const s = e.summary || '';
  switch (e.kind) {
    case 'CREATED':
    case 'PARTNER':
    case 'DRIVER':
    case 'SCHEDULE':
      return true;
    case 'WEIGHT':
      // A bag weighed back off the laundromat is one line per bag, and the
      // "collected from the laundromat" line plus the table footer already say
      // it. "Price held" written in the same second as the partner's total is
      // that total's consequence, and the total carries both numbers. And a
      // first save that a correction replaced is in the correction: "corrected
      // to 33.6 lb, was 17.4 lb" says everything the first line said.
      if (/weighed back at/i.test(s)) return false;
      if (/price held/i.test(s) && prev && prev.kind === 'PARTNER_WEIGHT' && Math.abs(new Date(e.created_at) - new Date(prev.created_at)) < 5000) return false;
      if (e.superseded) return false;
      return true;
    case 'PRICE':
      // A price written in the same second as a weight is that weight's money,
      // not a second thing that happened. The settle by hand is its own event.
      if (/settled|by hand/i.test(s)) return true;
      return !(prev && prev.kind === 'WEIGHT' && Math.abs(new Date(e.created_at) - new Date(prev.created_at)) < 5000);
    case 'PAYMENT':
      // "Nothing left to charge" on delivery is the backstop confirming the
      // weigh-in already took the money. Everything, not Human.
      return !/nothing left to charge/i.test(s);
    case 'STATUS':
      // A real transition has a from and a to. "Van clips 1, 2 back in the van"
      // is recorded as STATUS with neither, and is hardware.
      return Boolean(e.was && e.became);
    case 'PARTNER_WEIGHT':
      // The total, not each bag. "weighed all 2 bags at 27.6 lb" is the event;
      // "weighed bag 1 at 14.6 lb (1 of 2)" is how it was typed.
      return /weighed all /i.test(e.summary || '');
    case 'LABEL':
      return HUMAN_LABEL.some((re) => re.test(e.summary || ''));
    case 'NOTE':
      // "2 bags at the door" is the count being set, which is a fact about the
      // order rather than a thing that happened to it. Everything.
      return false;
    default:
      return false;
  }
}

// An exception is money or weight not going to plan: a hold, a correction, a
// partner figure outside tolerance, a settle by hand, a refused card, a return
// that did not reconcile. Anything with a reason written against it counts,
// because a reason is what a person writes when something needed explaining.
function isException(e) {
  if (e.reason) return true;
  const s = e.summary || '';
  if (e.kind === 'WEIGHT' && /held|corrected/i.test(s)) return true;
  if (e.kind === 'PRICE' && /settled|by hand/i.test(s)) return true;
  if (e.kind === 'PAYMENT' && e.became && e.became !== 'PAID') return true;
  if (e.kind === 'PAYMENT' && /declined|refused|failed/i.test(s)) return true;
  return false;
}

// Identical events inside a minute are one event that got written more than
// once. #1992 has "2 bags collected from the laundromat" three times in four
// seconds. The store keeps all three; the screen shows one.
function dedupe(events) {
  const out = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (
      last &&
      last.kind === e.kind &&
      last.summary === e.summary &&
      Math.abs(new Date(e.created_at) - new Date(last.created_at)) < 60_000
    ) {
      continue;
    }
    out.push(e);
  }
  return out;
}

// events: whatever orderEvents.forOrder() returned, any order. Returns them
// oldest first, filtered by view, deduplicated - and the counts for each view
// so the filter links can say how many rows they hide.
function humanEvents(events, view = 'human') {
  const asc = [...(events || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const all = dedupe(asc);
  // A doorstep weigh-in that a later correction replaced. Marked here, once,
  // rather than each caller working it out: the correction's own line carries
  // the old figure ("corrected to 33.6 lb, was 17.4 lb"), so the first save is
  // Everything and not Human.
  for (let i = 0; i < all.length; i += 1) {
    const e = all[i];
    if (e.kind !== 'WEIGHT' || !/^Weighed /i.test(e.summary || '')) continue;
    e.superseded = all.slice(i + 1).some((later) => later.kind === 'WEIGHT' && /corrected/i.test(later.summary || ''));
  }
  const human = all.filter((e, i) => isHuman(e, i > 0 ? all[i - 1] : null));
  const exceptions = all.filter(isException);
  const rows = view === 'all' ? all : view === 'exceptions' ? exceptions : human;
  return { rows, counts: { human: human.length, exceptions: exceptions.length, all: all.length } };
}

// ---------------------------------------------------------------------------
// THE CHARGE, AS A LEDGER.
//
// Rows that actually happened, in the order they happened: each weigh-in and
// correction with the price it implied, the partner's total with no dollar
// amount because their figure never bills, and the settle or charge. Read off
// the same events the log shows, so the two cannot disagree.
// ---------------------------------------------------------------------------
function chargeRows(events, order, { money }) {
  const asc = dedupe(
    [...(events || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  );
  const rate = order.price_per_lb_cents != null ? order.price_per_lb_cents : null;
  const rows = [];

  // PRICE events carry the money; the WEIGHT event a second before carries the
  // pounds. Pair them by timestamp.
  const weightAt = new Map();
  for (const e of asc) {
    if (e.kind !== 'WEIGHT') continue;
    const m = /([\d.]+) lb/.exec(e.became || e.summary || '');
    if (m) weightAt.set(new Date(e.created_at).getTime(), Number(m[1]));
  }

  const poundsNear = (iso) => {
    const t = new Date(iso).getTime();
    for (const [at, pounds] of weightAt) if (Math.abs(at - t) <= 5000) return pounds;
    return null;
  };

  let priced = 0;
  for (const e of asc) {
    if (e.kind === 'PRICE') {
      const settled = /settled|by hand/i.test(e.summary || '');
      // A weigh-in writes the money into became ("$67.20"); a settle by hand
      // writes the pounds there ("33.6 lb billed") and the money in the
      // sentence. Read whichever has it.
      const cents = /\$([\d.]+)/.exec(e.became || '') || /\$([\d.]+)/.exec(e.summary || '');
      // A PRICE with no WEIGHT beside it is the old weigh-in rule pricing off
      // the laundromat's scale ("Priced at $84.00 on 84 lb - the laundromat's
      // scale, the higher of the two, less $84.00 for CLEAN50"). The pounds and
      // the promotion are both in the sentence and nowhere else.
      const paired = settled ? null : poundsNear(e.created_at);
      const inSentence = lb((/ on ([\d.]+) lb/.exec(e.summary || '') || [])[1]);
      const pounds = settled
        ? lb((/([\d.]+) lb billed/.exec(e.became || '') || [])[1])
        : paired != null ? paired : inSentence;
      const promo = (/less (\$[\d.]+) for ([^.]+?)(?: - [^.]*)?$/.exec(e.summary || '') || []);
      const priceRule = !settled && paired == null && inSentence != null;
      priced += 1;
      rows.push({
        what: settled ? 'Settled by hand' : priceRule ? 'Priced at weigh-in' : priced === 1 ? 'Weigh-in (first save)' : 'Weigh-in corrected',
        lb: pounds,
        rate,
        cents: cents ? Math.round(Number(cents[1]) * 100) : null,
        when: e.created_at,
        note: settled
          ? (e.summary || '').replace(/^.*settled by hand:\s*/i, '')
          : promo[1] ? `less ${promo[1]} for ${promo[2].trim()}` : '',
        settled,
        priceRule,
      });
      continue;
    }
    if (e.kind === 'PARTNER_WEIGHT' && /weighed all /i.test(e.summary || '')) {
      // was/became are written as "33.6 lb", so the number has to be read out
      // of the sentence rather than cast from it.
      const parseLb = (s) => lb((/([\d.]+)\s*lb/.exec(s || '') || [])[1]);
      const theirs = parseLb(e.became);
      const ours = parseLb(e.was);
      const outside = Boolean(e.reason) || /outside/i.test(e.summary || '');
      const diff = ours != null && theirs != null ? ours - theirs : null;
      rows.push({
        what: 'Partner total',
        lb: theirs,
        rate: null,
        cents: null,
        when: e.created_at,
        note:
          diff == null
            ? ''
            : `${Math.abs(diff).toFixed(1)} ${diff > 0 ? 'light' : 'heavy'}${outside ? ' · hold' : ''}`,
        bad: outside,
      });
      continue;
    }
    if (e.kind === 'PAYMENT') {
      const cents = /\$([\d.]+)/.exec(e.summary || '');
      if (!cents) continue;
      rows.push({
        what: /declined|refused|failed/i.test(e.summary || '') ? 'Card declined' : 'Charged',
        lb: null,
        rate: null,
        cents: Math.round(Number(cents[1]) * 100),
        when: e.created_at,
        note: e.reason || '',
        bad: /declined|refused|failed/i.test(e.summary || ''),
        paid: (e.became || '') === 'PAID',
      });
    }
  }

  // The first-save row is superseded the moment a correction lands.
  const corrections = rows.filter((r) => r.what === 'Weigh-in corrected').length;
  if (corrections) {
    const first = rows.find((r) => r.what === 'Weigh-in (first save)');
    if (first) first.note = 'superseded';
  }
  // A settle that charged in the same breath is one line, not two.
  for (let i = rows.length - 1; i > 0; i -= 1) {
    if (
      rows[i].what === 'Charged' &&
      rows[i - 1].settled &&
      Math.abs(new Date(rows[i].when) - new Date(rows[i - 1].when)) < 60_000
    ) {
      rows[i - 1].paid = true;
      rows.splice(i, 1);
    }
  }
  if (!order.weight_photo_path) {
    const corrected = rows.find((r) => r.what === 'Weigh-in corrected');
    if (corrected && !corrected.note) corrected.note = 'no scale photo';
  }
  return rows.map((r) => ({ ...r, amount: r.cents != null ? money(r.cents) : null }));
}

// ---------------------------------------------------------------------------
// BAGS, ONE TABLE.
//
// A door bag and the laundromat's return bag that came out of it are one row.
// Lineage is bag_labels.parent_id, which is the thread back; the laundromat
// packs its own bags and never labels ours, so two in can be one out or four.
// Status while open is the label's own state; on a delivered order every row
// is simply done. RETIRED is what happens to a sticker, not a warning.
// ---------------------------------------------------------------------------
function bagRows(labels, order, { labelState }) {
  const list = labels || [];
  const pickup = list.filter((l) => l.leg === 'PICKUP' || (!l.leg && l.sticker_seq == null));
  const delivery = list.filter((l) => l.leg === 'DELIVERY' || l.sticker_seq != null);
  const byParent = new Map();
  for (const d of delivery) {
    const key = d.parent_id || '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(d);
  }
  const closed = ['DELIVERED', 'CANCELED'].includes(order.status);
  const stickerCode = (d) => (d.sticker_seq != null ? `${d.code}-${d.sticker_seq}` : d.code);

  const rows = [];
  for (const p of pickup) {
    const backs = byParent.get(p.id) || [];
    if (!backs.length) {
      rows.push({
        doorCode: p.code, doorLb: lb(p.weight_lb), backCode: null, backLb: null,
        lineage: '', status: closed ? 'done' : labelState(p).toLowerCase().replace('_', ' '),
        doorPosition: p.position,
      });
      continue;
    }
    backs.forEach((d, i) => {
      rows.push({
        doorCode: i === 0 ? p.code : null,
        doorLb: i === 0 ? lb(p.weight_lb) : null,
        backCode: stickerCode(d),
        backLb: lb(d.weight_lb),
        lineage: `from bag ${p.position} · they packed their own`,
        status: closed ? 'done' : labelState(d).toLowerCase().replace('_', ' '),
        doorPosition: p.position,
      });
    });
  }
  // Return bags with no parent recorded still have to be on the table.
  for (const d of byParent.get('') || []) {
    rows.push({
      doorCode: null, doorLb: null, backCode: stickerCode(d), backLb: lb(d.weight_lb),
      lineage: 'no door bag recorded', status: closed ? 'done' : labelState(d).toLowerCase().replace('_', ' '),
      doorPosition: 999,
    });
  }
  rows.sort((a, b) => a.doorPosition - b.doorPosition);

  const billed = lb(order.billable_weight_lb != null ? order.billable_weight_lb : order.weight_lb);
  const returned = lb(order.return_weight_lb);
  let match = '';
  if (billed != null && returned != null) {
    const check = tags.checkHandover({ wentIn: billed, cameBack: returned });
    match = check.ok
      ? 'matched · drying variance ok'
      : check.direction === 'LIGHTER'
        ? `${Math.abs(check.difference).toFixed(1)} lb short`
        : `${Math.abs(check.difference).toFixed(1)} lb over`;
  }
  return {
    rows,
    footer: { doorCount: pickup.length, billed, backCount: delivery.length, returned, match },
  };
}

// ---------------------------------------------------------------------------
// TEXTS FOR THIS ORDER.
//
// There is no order id on a message, and this page does not pretend there is.
// A message belongs to an order if it was sent while that order was live: from
// the booking to ten minutes after the delivery (the delivered text is sent a
// beat after the stamp). An open order runs to now. Everything after belongs
// to whatever came next, and the side column says where to find it.
// ---------------------------------------------------------------------------
function messagesForOrder(messages, order) {
  const from = new Date(order.created_at).getTime();
  const to = order.delivered_at
    ? new Date(order.delivered_at).getTime() + 10 * 60_000
    : order.status === 'CANCELED' && order.updated_at
      ? new Date(order.updated_at).getTime() + 10 * 60_000
      : Number.POSITIVE_INFINITY;
  const asc = [...(messages || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const mine = asc.filter((m) => {
    const t = new Date(m.created_at).getTime();
    return t >= from && t <= to;
  });
  const later = asc.filter((m) => new Date(m.created_at).getTime() > to).length;
  return { rows: mine, later };
}

// ---------------------------------------------------------------------------
// THE EXCEPTION STRIP, OR NOTHING.
//
// One block, under the toolbar, only when weight or money did not go to plan.
// It reads the same rules the money path uses - compareWeights() for the two
// scales, checkHandover() for what came back - so it cannot say "matched" about
// a load fulfilment refused.
// ---------------------------------------------------------------------------
function exceptionFor(order, events, limits = null) {
  const ours = lb(order.weight_lb);
  const theirs = lb(order.partner_weight_lb);
  const billed = lb(order.billable_weight_lb != null ? order.billable_weight_lb : order.weight_lb);
  const returned = lb(order.return_weight_lb);
  const held = Boolean(order.weight_held_at);
  const settledAt = order.weight_settled_at || null;
  const failedCard = order.payment_status === 'FAILED';
  const compare = partnersCore.compareWeights(order, limits);
  const handover = billed != null && returned != null ? tags.checkHandover({ wentIn: billed, cameBack: returned }) : null;

  const asc = [...(events || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const correction = asc.find((e) => e.kind === 'WEIGHT' && /corrected/i.test(e.summary || ''));
  const settle = asc.find((e) => e.kind === 'PRICE' && /settled|by hand/i.test(e.summary || ''));
  const scalesDisagree = compare && compare.tolerance != null && Math.abs(compare.difference) > compare.tolerance;
  const returnOff = handover && !handover.ok && !order.return_override_at;

  const any = held || Boolean(settle) || scalesDisagree || Boolean(correction) || failedCard || returnOff || Boolean(order.return_override_at);
  if (!any) return null;

  const open = held || failedCard || returnOff;
  const parts = [];
  if (correction) {
    parts.push(`We ${fmtLb(ours)} lb (first save was ${escapeHtml(correction.was || '?')}, then corrected${order.weight_photo_path ? '' : ', no scale photo'})`);
  } else if (ours != null) {
    parts.push(`We ${fmtLb(ours)} lb${order.weight_photo_path ? '' : ' (no scale photo)'}`);
  }
  if (compare) {
    parts.push(
      `${escapeHtml(order.partnerName || 'Partner')} ${fmtLb(theirs)} lb · Δ ${Math.abs(compare.difference).toFixed(1)}, tolerance ${compare.tolerance.toFixed(1)}`
    );
  }
  if (handover) {
    parts.push(
      handover.ok
        ? `Return ${fmtLb(returned)} back of ${fmtLb(billed)} billed, matched`
        : `Return ${fmtLb(returned)} back of ${fmtLb(billed)} billed, ${handover.direction === 'LIGHTER' ? 'short' : 'over'} by ${Math.abs(handover.difference).toFixed(1)}${order.return_override_at ? ' · released by an admin' : ''}`
    );
  }
  let headline;
  if (held) headline = 'Weight exception · open, price held';
  else if (returnOff) headline = 'Return does not reconcile · open';
  else if (failedCard) headline = 'Card refused · open';
  else if (settle) headline = `Weight exception · settled ${stamp(settle.created_at)}`;
  else if (order.return_override_at) headline = `Return released by an admin · ${stamp(order.return_override_at)}`;
  else headline = 'Weight corrected at the door';

  let how = '';
  if (settle) {
    const why = (settle.summary || '').replace(/^.*settled by hand:\s*/i, '').trim();
    how = `Hold then billed ${billed != null ? fmtLb(billed) + ' lb' : 'our weight'}${why ? ` because ${escapeHtml(why.replace(/\.$/, '').toLowerCase())}` : ''}.`;
  } else if (held) {
    how = 'Nothing charged and nothing said to the customer until somebody picks a weight.';
  }
  return { open, headline, parts, how, settledAt };
}

// ---------------------------------------------------------------------------
// WHICH BUTTONS EXIST, FROM THE STATE.
//
// Steps come from run.js: the first undone task is the one to offer. The rest
// of the toolbar is every other real route, shown only where it applies.
// ---------------------------------------------------------------------------
function actionsFor(order, { tasks = [], can = {}, exception = null, labels = [] } = {}) {
  const st = order.status;
  const closed = st === 'DELIVERED';
  const awaiting = orders.AWAITING_COLLECTION.includes(st);
  const inHands = orders.IN_OUR_HANDS.includes(st);
  const openException = Boolean(exception && exception.open);
  const out = { primary: [], also: [] };

  const nextTask = (tasks || []).find((t) => !t.done) || null;

  if (openException && can.override) {
    if (order.weight_held_at) out.primary.push({ key: 'settle', label: 'Settle weight' });
    if (order.payment_status === 'FAILED') out.primary.push({ key: 'charge', label: 'Try the card again' });
    if (order.return_weight_lb != null && !order.return_override_at) {
      const check = tags.checkHandover({ wentIn: order.weight_lb, cameBack: order.return_weight_lb });
      if (!check.ok) out.primary.push({ key: 'release-return', label: 'Release the return' });
    }
  }
  if (order.payment_status === 'FAILED' && can.text) out.also.push({ key: 'card-link', label: 'Text them a way to update it' });

  if (!closed && nextTask && can.act) out.primary.push({ key: 'task', task: nextTask });

  if (awaiting && can.override) out.also.push({ key: 'cancel', label: 'Cancel this pickup' });
  if (can.customers && !closed) out.also.push({ key: 'driver', label: 'Move to another driver' });
  if (labels.length) out.also.push({ key: 'tags', label: 'Print tags', href: '/ops/labels' });
  if (order.delivery_photo_url) out.also.push({ key: 'photo', label: 'Delivery photo', href: `/p/${order.id}` });
  if (order.weight_photo_path && can.money) {
    out.also.push({ key: 'scale-photo', label: 'Scale photo', href: `/ops/orders/${order.order_number}/scale-photo` });
  }
  if (closed && order.payment_status === 'PAID' && !openException && can.text) {
    out.primary.push({ key: 'regular', label: 'Text: make it regular' });
  }
  if (inHands && can.act && (tasks || []).some((t) => t.key.startsWith('weigh_') && t.done)) {
    out.also.push({ key: 'correct', label: 'Correct a weight' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// RENDERING
// ---------------------------------------------------------------------------

function chips(order, exception) {
  const list = [];
  const st = order.status;
  const label = st.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  list.push(`<span class="chip ${st === 'DELIVERED' ? 'ok' : st === 'CANCELED' ? '' : 'warn'}">${escapeHtml(label)}</span>`);
  if (order.payment_status === 'PAID') list.push('<span class="chip ok">Paid</span>');
  else if (order.payment_status === 'FAILED') list.push('<span class="chip bad">Card refused</span>');
  else if (order.payment_status === 'WAIVED') list.push('<span class="chip">Nothing to charge</span>');
  if (exception) list.push(`<span class="chip ${exception.open ? 'bad' : 'warn'}">${exception.open ? 'Exception open' : 'Exception settled'}</span>`);
  return list.join(' ');
}

// Every stage stamp comes off the order's own column when it has one and off
// the STATUS event otherwise. "Out" has no column at all (TIMESTAMP_FOR in
// orders.js records no out_for_delivery_at), and a rail that could only read
// columns read "Delivered -" on a delivered order the first time a select list
// left one out. The event is the append-only record; the column is a copy.
function stageRail(order, events = []) {
  const reached = (status) => {
    const e = (events || []).find((x) => x.kind === 'STATUS' && x.became === status);
    return e ? e.created_at : null;
  };
  const at = (column, status) => order[column] || reached(status);
  const collected = at('collected_at', 'IN_PROCESS');
  const atPartner = at('at_partner_at', 'AT_PARTNER');
  const ready = at('ready_at', 'READY');
  const out = reached('OUT_FOR_DELIVERY');
  const delivered = at('delivered_at', 'DELIVERED');

  const cells = [
    { n: 'Booked', t: order.created_at ? stamp(order.created_at) : '', on: Boolean(order.created_at) },
    { n: 'Picked up', t: collected ? `${stamp(collected)}${order.weight_lb ? ` · ${fmtLb(order.weight_lb)} lb` : ''}` : '', on: Boolean(collected) },
    { n: 'At partner', t: atPartner ? `${order.partnerName ? escapeHtml(order.partnerName) + ' ' : ''}${clock(atPartner)}` : '', on: Boolean(atPartner) },
    { n: 'Ready', t: ready ? clock(ready) : '', on: Boolean(ready) },
    { n: 'Out', t: out ? clock(out) : '', on: Boolean(out) },
    { n: 'Delivered', t: delivered ? `${clock(delivered)}${order.driverName ? ` · ${escapeHtml(order.driverName.split(' ')[0])}` : ''}` : '', on: Boolean(delivered) },
  ];
  if (order.status === 'CANCELED') cells.push({ n: 'Cancelled', t: '', on: true });
  const current = cells.findIndex((c) => !c.on);
  return `<div class="rail">${cells
    .map((c, i) => `<div class="s${c.on ? ' on' : i === current ? ' now' : ''}"><div class="n">${c.n}</div><div class="t">${c.t || '—'}</div></div>`)
    .join('')}</div>`;
}

function stripHtml(x) {
  if (!x) return '';
  return `<div class="strip${x.open ? ' open' : ''}">
    <b>${escapeHtml(x.headline)}.</b> ${x.parts.join(' · ')}.
    ${x.how ? `<div class="row">${x.how}</div>` : ''}
  </div>`;
}

function taskForm(order, task, can) {
  const n = order.order_number;
  const k = task.key;
  const back = '';
  const btn = (label, cls = 'cbtn primary') => `<button type="submit" class="${cls}">${escapeHtml(label)}</button>`;
  const code = (task.label && task.label.code) || '';

  if (k === 'collected') return `<form method="post" action="/ops/orders/${n}/collected${back}">${btn(task.title || 'Collected')}</form>`;
  if (k === 'bag_count') {
    return `<form method="post" action="/ops/orders/${n}/bag-count${back}"><span class="field"><label for="bag_count">Bags</label><input type="number" id="bag_count" name="bag_count" min="1" max="20" inputmode="numeric" required style="width:5em">${btn("That's how many")}</span></form>`;
  }
  if (k.startsWith('tag_')) {
    return scanField({ action: `/ops/orders/${n}/label${back}`, label: `Code off the tag for bag #${task.position}`, buttonLabel: `That's bag #${task.position}` });
  }
  if (k.startsWith('weigh_')) {
    return `<form method="post" action="/ops/orders/${n}/bag-weight${back}"><input type="hidden" name="code" value="${escapeHtml(code)}"><span class="field"><label for="weight_lb">Bag #${task.position} lb</label><input type="number" id="weight_lb" name="weight_lb" step="0.01" min="0.1" inputmode="decimal" required style="width:6em">${btn('Save weight')}</span></form>`;
  }
  if (k.startsWith('clip_')) {
    return `<form method="post" action="/ops/orders/${n}/bag-clip${back}"><input type="hidden" name="code" value="${escapeHtml(code)}">${btn(`Clip on bag #${task.position}`)}</form>`;
  }
  if (k.startsWith('load_')) {
    return `<form method="post" action="/ops/orders/${n}/bag-van${back}"><input type="hidden" name="code" value="${escapeHtml(code)}"><input type="hidden" name="bag_in_van" value="on">${btn(`Bag #${task.position} in the van`)}</form>`;
  }
  if (k === 'van') return `<form method="post" action="/ops/orders/${n}/in-van${back}">${btn('All bags in the van')}</form>`;
  if (k === 'at_partner') {
    const opts = (can.laundromats || [])
      .map((p) => `<option value="${escapeHtml(p.id)}"${p.id === order.intended_partner_id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
      .join('');
    return `<form method="post" action="/ops/orders/${n}/at-partner${back}">${opts ? `<span class="field"><label for="partner_id">Laundromat</label><select id="partner_id" name="partner_id">${opts}</select>` : '<span class="field">'}${btn('Dropped at the laundromat')}</span></form>`;
  }
  if (k === 'ready') return `<form method="post" action="/ops/orders/${n}/ready${back}">${btn('Laundromat says ready')}</form>`;
  if (k === 'return') {
    return `<form method="post" action="/ops/orders/${n}/return${back}"><span class="field"><label for="return_bag_count">Bags back</label><input type="number" id="return_bag_count" name="return_bag_count" min="1" max="20" inputmode="numeric" required style="width:4em"><label for="return_weight_lb">lb</label><input type="number" id="return_weight_lb" name="return_weight_lb" step="0.01" min="0.1" inputmode="decimal" required style="width:6em">${btn('Weighed back in')}</span></form>`;
  }
  if (k === 'out') return `<form method="post" action="/ops/orders/${n}/out-for-delivery${back}">${btn('Out for delivery')}</form>`;
  if (k === 'scan') return scanField({ action: `/ops/orders/${n}/door-scan${back}`, label: 'Bag in your hand', buttonLabel: 'That one' });
  if (k === 'delivered') {
    return `<form method="post" action="/ops/orders/${n}/delivered${back}" enctype="multipart/form-data"><span class="field"><label for="photo">Photo at the door</label><input type="file" id="photo" name="photo" accept="image/*" capture="environment" required>${btn('Delivered')}</span></form>`;
  }
  return '';
}

function toolbarHtml(order, actions, can) {
  const n = order.order_number;
  const parts = [];
  for (const a of actions.primary) {
    if (a.key === 'task') parts.push(taskForm(order, a.task, can));
    else if (a.key === 'settle') parts.push(`<a class="cbtn primary" href="#settle">Settle weight</a>`);
    else if (a.key === 'charge') parts.push(`<form method="post" action="/ops/orders/${n}/charge"><button type="submit" class="cbtn primary">Try the card again</button></form>`);
    else if (a.key === 'release-return') parts.push(`<a class="cbtn primary" href="#release">Release the return</a>`);
    else if (a.key === 'regular') parts.push(`<a class="cbtn primary" href="#send">Text: make it regular</a>`);
  }
  for (const a of actions.also) {
    if (a.href) parts.push(`<a class="cbtn" href="${escapeHtml(a.href)}"${a.key === 'photo' ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(a.label)}</a>`);
    else if (a.key === 'card-link') parts.push(`<form method="post" action="/ops/orders/${n}/card-link"><button type="submit" class="cbtn">${escapeHtml(a.label)}</button></form>`);
    else if (a.key === 'cancel') parts.push(`<a class="cbtn danger" href="#cancel">${escapeHtml(a.label)}</a>`);
    else if (a.key === 'driver') parts.push(`<a class="cbtn" href="#driver">${escapeHtml(a.label)}</a>`);
    else if (a.key === 'correct') parts.push(`<a class="cbtn" href="#correct">${escapeHtml(a.label)}</a>`);
  }
  return parts.length ? `<div class="toolbar">${parts.join('')}</div>` : '';
}

function bagsTable(bags, order) {
  const n = order.order_number;
  const link = (code) => (code ? `<a href="/ops/labels/${escapeHtml(code.split('-')[0])}" class="mono">${escapeHtml(code)}</a>` : '');
  const body = bags.rows.length
    ? bags.rows
        .map(
          (r) => `<tr>
        <td class="mono">${link(r.doorCode)}</td><td class="num">${r.doorLb == null ? '' : r.doorLb.toFixed(1)}</td>
        <td class="mono">${link(r.backCode)}</td><td class="num">${r.backLb == null ? '' : r.backLb.toFixed(1)}</td>
        <td>${escapeHtml(r.lineage)}</td><td>${escapeHtml(r.status)}</td></tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="muted">No bags on order #${n} yet.</td></tr>`;
  const f = bags.footer;
  return `<h2>Bags</h2><div class="tablewrap"><table class="data">
    <thead><tr><th>Taken at door</th><th class="num">Lb</th><th>Back from partner</th><th class="num">Lb</th><th>Lineage</th><th>Status</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td>${f.doorCount} bag${f.doorCount === 1 ? '' : 's'} · billed</td><td class="num">${f.billed == null ? '—' : f.billed.toFixed(1)}</td>
    <td>${f.backCount} bag${f.backCount === 1 ? '' : 's'} · returned</td><td class="num">${f.returned == null ? '—' : f.returned.toFixed(1)}</td>
    <td colspan="2">${escapeHtml(f.match)}</td></tr></tfoot></table></div>`;
}

// HOW IT WAS ACTUALLY PAID. Total, card, cash, balance.
//
// Neil, 14 September: the order must not say "Paid - Cash". It says
// Total $95 / Card $80 / Cash $15 / Balance $0 - Paid. A single word cannot
// describe an order settled two ways, and calling the whole thing cash when
// only the leftover was would be false on the one screen that has to be right.
//
// IT APPEARS ONLY WHEN THERE IS A LEDGER TO SHOW. Every order taken before the
// payments table existed has no rows, and drawing Card $0 / Cash $0 over an
// order that was plainly paid by card would invent a fact. Those keep the
// status chip they always had.
// THE $25 SITTING ON THEIR CARD, SAID OUT LOUD.
//
// Held, taken, or refused - three different facts and a person on the phone to
// a customer needs to know which. A hold is invisible everywhere else in ops:
// it is not a payment, so the ledger has nothing to say about it, and it is not
// a status, so the badge cannot carry the amount.
function holdLine(order, { money }) {
  const held = Number(order.authorization_intent_id ? order.authorized_cents || 0 : 0);
  const taken = Number(order.captured_cents || 0);

  if (held > 0) {
    return `<p class="muted">${escapeHtml(money(held))} is held on the card for this pickup.
      Held, not taken - it comes off at the door.</p>`;
  }

  if (order.authorization_refused_at) {
    return `<p class="muted"><b>The card would not accept the hold.</b>
      ${escapeHtml(order.authorization_refused_reason || 'No reason given.')}
      This pickup stays off the round until a card accepts one.</p>`;
  }

  if (taken > 0) {
    return `<p class="muted">${escapeHtml(money(taken))} was taken off the hold.</p>`;
  }

  return '';
}

function paidTable(split, { money }) {
  if (!split || !split.ledger) return '';

  const row = (label, cents, strong) =>
    `<tr><th>${escapeHtml(label)}</th><td class="num">${
      strong ? `<b>${escapeHtml(money(cents))}</b>` : escapeHtml(money(cents))
    }</td></tr>`;

  // AN UNPRICED ORDER WITH A LEDGER ROW IS A REAL THING NOW, and it is the
  // doorstep refusal: $25 kept for the trip, the bags left behind, the pickup
  // put back to tomorrow and no price ever written. Drawing Total $0.00 /
  // Balance $0.00 / Paid over that would call an order paid that was never
  // charged for - so when there is no price there is nothing to balance, and
  // the table says the one thing that is true.
  if (!split.total) {
    return split.trip
      ? `<h2>Paid</h2><div class="tablewrap"><table class="kv">
          ${row('Trip (not the wash)', split.trip, true)}
        </table></div>
        <p class="muted">The driver came out and the bags were left. Nothing has been
           charged for a wash, and this does not come off the rebooked pickup.</p>`
      : '';
  }

  return `<h2>Paid</h2><div class="tablewrap"><table class="kv">
    ${row('Total', split.total)}
    ${split.card ? row('Card', split.card) : ''}
    ${split.cash ? row('Cash', split.cash) : ''}
    ${
      // THE TRIP, ON ITS OWN LINE AND OUTSIDE THE BALANCE. Money that was taken
      // and does not pay for this wash: the driver came out, the bags were
      // weighed, the extra charge was refused and the laundry stayed on the
      // step. Folding it into Card would read as money off a wash that never
      // happened, which is the one thing Neil said it must never be.
      split.trip ? row('Trip (not the wash)', split.trip) : ''
    }
    ${row('Balance', split.balance, true)}
    <tr><th></th><td>${
      split.balance === 0
        ? '<span class="chip ok">Paid</span>'
        : '<span class="chip bad">Still owed</span>'
    }</td></tr>
  </table></div>`;
}

// TAKING CASH, WHICH IS ONLY EVER A RECOVERY.
//
// Drawn only when the order is on payment hold: the card was refused, we are
// holding the laundry, and money is still owed. That is the single situation
// Neil allows cash in, and the route refuses every other one as well - a form
// that is merely absent is not a guard.
//
// It offers the OUTSTANDING amount, not the total, because that is the only
// thing anybody may record. Anything more is change, which this system cannot
// give back.
function cashForm(order, split, { money, can }) {
  if (!can.override) return '';
  if (order.payment_status !== 'FAILED') return '';

  const outstanding = split && split.ledger ? split.balance : Number(order.price_cents || 0) - Number(order.amount_paid_cents || 0);
  if (!(outstanding > 0)) return '';

  return `<h2>Cash</h2>
  <p class="muted">The card was refused and we are holding the laundry.
     ${escapeHtml(money(outstanding))} is outstanding. Recording cash does not text
     anybody, and it does not put the order on today's round - it only makes it
     eligible again once nothing is owed.</p>
  <form method="post" action="/ops/orders/${order.order_number}/cash" class="toolbar">
    <span class="field">
      <label for="cash-amount">Cash taken</label>
      <input id="cash-amount" name="amount" inputmode="decimal" autocomplete="off"
             placeholder="${escapeHtml((outstanding / 100).toFixed(2))}" required>
    </span>
    <span class="field">
      <label for="cash-note">Note</label>
      <input id="cash-note" name="note" autocomplete="off" placeholder="optional">
    </span>
    <button type="submit" class="cbtn">Record cash</button>
  </form>`;
}

function chargeTable(rows, { money }) {
  if (!rows.length) return '';
  const rate = (r) => (r.rate == null ? '—' : (r.rate / 100).toFixed(2));
  return `<h2>Charge</h2><div class="tablewrap"><table class="data">
    <thead><tr><th>What</th><th class="num">Lb</th><th class="num">Rate</th><th class="num">Amount</th><th>When</th><th>Note</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr><td>${escapeHtml(r.what)}</td><td class="num">${r.lb == null ? '—' : r.lb.toFixed(1)}</td><td class="num">${rate(r)}</td>
        <td class="num">${r.amount == null ? '—' : r.paid ? `<b>${escapeHtml(r.amount)}</b>` : escapeHtml(r.amount)}</td>
        <td class="mono">${clock(r.when)}</td><td${r.bad ? ' style="color:var(--c-red)"' : ''}>${escapeHtml(r.note || '')}</td></tr>`
      )
      .join('')}</tbody></table></div>`;
}

function logTable(order, log, view) {
  const n = order.order_number;
  const f = (key, label, count) =>
    view === key ? `<span class="on">${label} (${count})</span>` : `<a href="/ops/orders/${n}?log=${key}#log">${label} (${count})</a>`;
  return `<h2 id="log">Log</h2>
  <div class="filters">${f('human', 'Human', log.counts.human)} ${f('exceptions', 'Exceptions only', log.counts.exceptions)} ${f('all', 'Everything', log.counts.all)}</div>
  <div class="tablewrap"><table class="data log">
    <thead><tr><th style="width:118px">Time</th><th>Event</th><th>Who</th></tr></thead>
    <tbody>${log.rows
      .map((e) => `<tr><td class="mono">${stamp(e.created_at)}</td><td>${escapeHtml(e.summary || '')}${e.reason ? ` <span class="muted">· ${escapeHtml(e.reason)}</span>` : ''}</td><td class="who">${escapeHtml(e.actor || '')}</td></tr>`)
      .join('') || '<tr><td colspan="3" class="muted">Nothing yet.</td></tr>'}</tbody></table></div>
  ${view === 'human' ? '<p class="hint">Van clips, tag off, in-house receipt off stay on the bag record. Not in Human.</p>' : ''}`;
}

function kv(pairs) {
  return `<table class="kv">${pairs.filter((p) => p).map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`).join('')}</table>`;
}

function threadHtml(order, thread, can) {
  if (!can.messages) return '';
  const n = order.order_number;
  const rows = thread.rows
    .map(
      (m) => `<div class="m${m.direction === 'INBOUND' ? ' in' : ''}"><div class="when">${m.direction === 'INBOUND' ? 'Them' : m.sent_by ? 'Us (typed)' : 'Us'} · ${stamp(m.created_at)}</div>${escapeHtml(m.body || '')}</div>`
    )
    .join('');
  const phone = order.customers && order.customers.phone;
  return `<h2>Texts for #${n}</h2><div class="thread">${rows || '<div class="m muted">No texts during this order.</div>'}</div>
  ${thread.later ? `<p class="hint">${thread.later} later text${thread.later === 1 ? '' : 's'} belong to what came next. <a href="/ops/messages/${escapeHtml(phone || '')}">Customer thread</a>.</p>` : ''}`;
}

// The whole page body. Everything the route already knows comes in; nothing is
// fetched here.
function orderConsoleBody({
  order, customer, events, labels, messages, tasks, team, laundromats, limits,
  can, view, banner, money, shortDate, labelState, sideExtras = '',
  // The rows from the payments ledger. Absent on an order taken before that
  // table existed, which is why paidTable() draws nothing without them rather
  // than inventing Card $0.
  paymentRows = [],
}) {
  const n = order.order_number;
  const c = customer || {};
  const exception = exceptionFor(order, events, limits);
  const log = humanEvents(events, view);
  const charge = can.money ? chargeRows(events, order, { money }) : [];
  const split = payments.splitFor(order, paymentRows);
  const bags = bagRows(labels, order, { labelState });
  const thread = can.messages ? messagesForOrder(messages, order) : { rows: [], later: 0 };
  const actions = actionsFor(order, { tasks, can, exception, labels });

  const address = [c.address_line1, c.address_line2, c.city ? `${c.city} ${c.postal_code || ''}`.trim() : c.postal_code].filter(Boolean).join(', ');
  const title = can.customers ? c.name || 'Unknown' : address || `Order #${n}`;
  const window = order.pickup_window_start ? booking.arrivalWindow(order) : '';
  const asked = order.pickup_time ? order.pickup_time.slice(0, 5) : '';
  const prefs = c.preferences || {};
  const spot = prefs.dropoff_spot || prefs.special_instructions || '';

  const meta = [
    can.customers && address ? `<span>${escapeHtml(address)}</span>` : '',
    `<span>Pickup <b>${escapeHtml(shortDate(order.pickup_date))}${window ? ' ' + escapeHtml(window) : ''}</b></span>`,
    asked ? `<span>Asked <b>${escapeHtml(asked)}</b></span>` : '',
    spot ? `<span>${escapeHtml(spot)}</span>` : '',
    order.driverName ? `<span>Driver <b>${escapeHtml(order.driverName)}</b></span>` : '',
    order.partnerName ? `<span>Partner <b>${escapeHtml(order.partnerName)}</b></span>` : '',
  ].filter(Boolean).join('');

  const washBits = [prefs.water_temp, prefs.detergent, prefs.fabric_softener && prefs.fabric_softener !== 'NONE' ? 'softener' : null]
    .filter(Boolean).map((s) => String(s).toLowerCase());

  const orderKv = kv([
    ['Wash', escapeHtml(washBits.join(', ') || '—')],
    ['Method', escapeHtml(spot || '—')],
    order.notes ? ['Note', escapeHtml(order.notes)] : null,
    ['Booked', escapeHtml(stamp(order.created_at))],
    can.money ? ['Photo in', order.weight_photo_path ? `<a href="/ops/orders/${n}/scale-photo">scale</a>` : 'none'] : null,
    ['Photo out', order.delivery_photo_url ? `<a href="/p/${escapeHtml(order.id)}" target="_blank" rel="noopener">delivery</a>` : 'none'],
    order.promotionName ? ['Promotion', `${escapeHtml(order.promotionName)}${order.discount_cents ? ` · -${escapeHtml(money(order.discount_cents))}` : ''}`] : null,

    // WHAT IS COMING OFF, ON AN ORDER NOTHING HAS COME OFF YET.
    //
    // The row above is the FACT: loadVan() wrote it when it priced the order.
    // This is the FORECAST, and the two are never both drawn - expectedPromotion
    // is null on anything that already carries a promotion_id.
    //
    // IT SAYS EXPECTED IN THE VALUE, NOT ONLY IN THE HEADING. That is the whole
    // reason the board is not allowed to carry this: a name sitting under a word
    // that reads Promotion says the money has already come off. Here there is
    // room for the sentence to be honest, which is why Neil sent the question to
    // this page.
    //
    // NO FIGURE, DELIBERATELY. The discount is a percentage of a price nobody
    // has weighed yet, so any number here would be invented - and a pound
    // figure on a screen becomes the figure somebody quotes.
    !order.promotionName && order.expectedPromotion
      ? [
          'Promotion',
          `<span class="muted">expected:</span> ${escapeHtml(
            order.expectedPromotion.code || order.expectedPromotion.name
          )} · comes off when it is weighed`,
        ]
      : null,
  ]);

  const customerKv = can.customers
    ? kv([
        ['Name', escapeHtml(c.name || '—')],
        // The link is a route parameter and keeps the stored number; the text is
        // what a person reads.
        ['Phone', c.phone ? `<a href="/ops/messages/${escapeHtml(c.phone)}" class="mono">${escapeHtml(format.displayPhone(c.phone))}</a>` : '—'],
        can.money ? ['Card', c.card_brand ? `${escapeHtml(c.card_brand.charAt(0).toUpperCase() + c.card_brand.slice(1))} ${escapeHtml(c.card_last4 || '')}` : c.default_payment_method_id ? 'wallet, no card' : 'none on file'] : null,
        ['', `<a href="/ops/customers/${escapeHtml(c.id || '')}">Full profile</a>`],
      ])
    : '';

  return `<div class="console">
  <div class="crumb"><a href="/ops">Orders</a> / ${n}</div>
  <div class="title-row"><h1>${escapeHtml(title)}</h1><span class="id">#${n}</span> ${chips(order, exception)}</div>
  <div class="meta">${meta}</div>
  ${banner || ''}
  ${toolbarHtml(order, actions, { ...can, laundromats })}
  ${stripHtml(exception)}
  ${stageRail(order, events)}
  <div class="layout">
    <div>
      ${bagsTable(bags, order)}
      ${can.money ? chargeTable(charge, { money }) : ''}
      ${can.money ? holdLine(order, { money }) : ''}
      ${can.money ? paidTable(split, { money }) : ''}
      ${can.money ? cashForm(order, split, { money, can }) : ''}
      ${can.audit ? logTable(order, log, view) : ''}
    </div>
    <div class="side">
      <h2>Order</h2>${orderKv}
      ${can.customers ? `<h2>Customer</h2>${customerKv}` : ''}
      ${sideExtras}
      ${threadHtml(order, thread, can)}
    </div>
  </div>
</div>`;
}

module.exports = {
  orderConsoleBody,
  holdLine,
  paidTable,
  cashForm,
  humanEvents,
  chargeRows,
  bagRows,
  messagesForOrder,
  exceptionFor,
  actionsFor,
  stageRail,
  stamp,
  isHuman,
  isException,
  dedupe,
};
