'use strict';

const db = require('../db');
const { config } = require('../config');

// ---------------------------------------------------------------------------
// WHAT IS IN THE VAN, AT THE START OF A SHIFT.
//
// Neil, 16 September, when the van stopped being a custody state: freeing a
// clip at the counter means nobody confirms it is back in the van, so the
// question "is clip 17 actually here" has no answer anywhere. His call was that
// this is an INVENTORY problem rather than a fulfilment one, and that it must
// not become a tap on every stop.
//
// So this is a screen you look at once, before you set off, and never again.
// Nothing here is part of a pickup, a drop, a retrieval or a delivery, and
// nothing on it changes an order.
//
// IT IS READ-ONLY AND DERIVED, WITH NO TABLE BEHIND IT. There is no clip ledger
// and no start-of-shift count stored anywhere: the clips a driver has out are a
// query over the bags wearing them, the same way the partner load and the
// driver's progress are queries rather than counters. A stored count would be a
// second copy of a fact the bags already hold, and would go stale the first
// time anybody did something by hand.
//
// THE TEST FOR "TAKEN" IS `clip_returned_at`, AND IT IS THE SAME ONE
// `bags.clipsInUse()` USES - deliberately, because that is the function that
// hands numbers out. Filtering on `unclipped_at` as well reads cleaner and is
// wrong: a clip taken off a bag at a counter is in somebody's pocket, not in
// the van, and the allocator still counts it as out. Two different answers to
// "is clip 4 free" is the drift this file must not introduce, and a test pins
// the two filters together.
//
// THREE STATES, AND ONLY ONE OF THEM IS A PROBLEM:
//
//   on a bag      wearing it right now, on a live order. Expected to be out.
//   in the van    nothing is wearing it and nothing is holding it, so it should
//                 physically be in the van. This is the list to count against.
//   unaccounted   the system is still holding the number and cannot say where
//                 it is: the bag was handed over without the clip being freed,
//                 or the order finished with it still on.
//
// That third one is derivable and the other kind of missing is not: a clip the
// system thinks is in the van and is not there can only be found by a person
// looking in the van. That is what the second list is for, and it is why the
// page asks for a count rather than claiming an answer.
// ---------------------------------------------------------------------------

// A finished order should have released every clip on its way through. One that
// still holds a number is holding it for ever, because nothing is coming back
// to that order to let it go.
const FINISHED = Object.freeze(['DELIVERED', 'CANCELED']);

// THE DERIVATION IS SEPARATE FROM THE QUERY so it can be tested without a
// database - CLAUDE.md's rule for any new rule that does not need one. Below is
// the query; everything that decides what a number MEANS is here.
function fromRows(rows, total) {
  const held = new Map();

  for (const row of rows || []) {
    const n = Number(row.clip_number);
    if (!Number.isFinite(n)) continue;

    const order = row.orders || {};

    // Why the system cannot say where it is. Null means it can: the bag is on a
    // live order and the clip is on the bag.
    let stranded = null;
    if (FINISHED.includes(order.status)) stranded = 'order_finished';
    else if (row.unclipped_at) stranded = 'never_returned';

    // A clip on two bags at once is not possible by design. If it ever happens,
    // the louder of the two states is the one worth showing.
    const existing = held.get(n);
    if (existing && existing.stranded) continue;

    held.set(n, {
      clip: n,
      code: row.sticker_seq ? `${row.code}-${row.sticker_seq}` : row.code,
      orderNumber: order.order_number,
      status: order.status,
      stranded,
    });
  }

  const describe = (n, on) => ({
    clip: n,
    state: on.stranded ? 'unaccounted' : 'on_a_bag',
    why: on.stranded || undefined,
    code: on.code,
    orderNumber: on.orderNumber,
    orderStatus: on.status,
  });

  const clips = [];
  for (let n = 1; n <= total; n += 1) {
    const on = held.get(n);
    clips.push(on ? describe(n, on) : { clip: n, state: 'in_the_van' });
  }

  // A clip number above the pool is a bag wearing a number nobody owns - the
  // pool shrank, or somebody typed one in. Worth saying rather than hiding, and
  // it can never be "in the van", because the van does not have one.
  for (const [n, on] of held) {
    if (n <= total) continue;
    clips.push({ ...describe(n, on), state: 'unaccounted', why: on.stranded || 'outside_pool', outsidePool: true });
  }

  clips.sort((a, b) => a.clip - b.clip);

  const count = (state) => clips.filter((c) => c.state === state).length;

  return {
    total,
    clips,
    onBags: count('on_a_bag'),
    inTheVan: count('in_the_van'),
    unaccounted: count('unaccounted'),
  };
}

async function inventory(driverId) {
  const total = Number(config.routing.vanClips) || 0;

  // Every number this driver's bags are holding, with enough of the order to
  // say whether it is legitimately out or stranded. The filter is
  // `bags.clipsInUse()`'s filter - see the note at the top of this file.
  const { data, error } = await db
    .from('bag_labels')
    .select('clip_number, code, sticker_seq, unclipped_at, orders!inner(order_number, status, driver_id)')
    .not('clip_number', 'is', null)
    .is('clip_returned_at', null)
    .eq('orders.driver_id', driverId);

  if (error) throw error;

  return fromRows(data, total);
}

module.exports = { inventory, fromRows, FINISHED };
