'use strict';

const db = require('../db');
const dispatch = require('./dispatch');
const booking = require('./booking');
const bags = require('./bags');
const loadout = require('./loadout');

// ---------------------------------------------------------------------------
// The guided run: one stop at a time, and nothing else on the screen.
//
// The routing board is the whole day laid out for somebody at a desk. This is
// the same day for somebody in a van, and the difference is that a driver
// should never have to work out what to do next. He opens the page, it says go
// here, he taps a button that opens his maps app, he drives. He comes back, he
// taps "I'm here", and only then does it tell him what to do at this door. When
// that is done it says go here next.
//
// ONE THING ON THE SCREEN AT A TIME. The order page shows an order and every
// legal action on it, which is right when you are looking something up and
// wrong when you are standing on a doorstep with two bags in your hands. A
// screen showing four buttons where three are not what you are doing is a
// screen you have to read; a screen showing one is a screen you can act on.
//
// NOTHING HERE IS A NEW WAY TO CHANGE AN ORDER. Every action posts to the same
// routes the order page posts to, which call src/core/fulfilment.js. This file
// works out WHAT IS NEXT and nothing else - the moment it started doing a step
// itself, the two front doors would drift, which is the same rule booking.js
// and fulfilment.js already live by.
// ---------------------------------------------------------------------------

// What has to be true at a stop before it is behind you.
//
// Derived from the order every time rather than stored as a "step" column. A
// driver who uses the order page, or the JSON API, or a second phone, is still
// at the same point in the run - because the run is a reading of the orders
// rather than a thing kept alongside them.
// A PICKUP, IN THE ORDER A DRIVER ACTUALLY DOES IT.
//
// He is standing at a door with his hands full. So: how many bags are there?
// Then one bag at a time - sticker on it, on the scale, photograph the display -
// and on to the next. Then they go in the van.
//
// The old order asked for stickers before anybody had said how many bags there
// were, and then for one total weight at the end, which asks him to add up in
// his head and loses which bag was the heavy one.
async function tasksForCollect(order) {
  const labels = await bags.forOrder(order.id);
  const known = order.bag_count != null;
  const bagCount = Number(order.bag_count || 0);

  const tasks = [
    {
      key: 'bag_count',
      title: known
        ? `${bagCount} bag${bagCount === 1 ? '' : 's'}`
        : 'How many bags are you picking up?',
      detail: 'Count them before you start, so the screen knows how many to walk you through.',
      done: known,
    },
  ];

  // One block of three steps per bag: sticker, scale, photo. The photo is part
  // of weighing rather than a step of its own - it is one form, and splitting
  // them would let a weight be recorded with no evidence behind it.
  for (let position = 1; position <= bagCount; position += 1) {
    const label = labels.find((l) => l.position === position) || null;

    tasks.push({
      key: `bag_${position}`,
      position,
      label,
      title: label
        ? label.weight_lb != null
          ? `Bag ${position} - ${label.weight_lb} lb on clip ${label.clip_number}`
          : `Weigh bag ${position}, photograph the scale`
        : `Put a sticker on bag ${position}`,
      detail: label
        ? 'On the scale, then a photo of the display with the bag on it.'
        : 'Peel one off the roll, stick it on this bag, type the six characters.',
      // Done only when it is both labelled AND weighed. A stickered bag nobody
      // put on the scale is not finished with.
      done: Boolean(label && label.weight_lb != null),
      needsLabel: !label,
    });
  }

  tasks.push({
    key: 'collected',
    title: order.collected_at ? 'In the van' : 'Put them in the van',
    detail: 'Tap this once all of them are actually in the van.',
    done: Boolean(order.collected_at),
    blockedBy: tasks.slice(1).every((t) => t.done) ? null : 'bags',
  });

  return tasks;
}

async function tasksForDeliver(order) {
  const scan = await loadout.allBagsScanned(order.id);

  return [
    {
      key: 'scan',
      title: scan.ok ? 'Bags checked' : 'Scan every bag',
      detail: `${scan.scanned} of ${scan.total} scanned. This is what proves you have the right ones.`,
      done: scan.ok,
      scan,
    },
    {
      key: 'delivered',
      title: 'One photo where you left them, then done',
      detail: 'However many bags, one picture of the drop-off.',
      done: Boolean(order.delivered_at),
      blockedBy: scan.ok ? null : 'scan',
    },
  ];
}

// Is this stop finished?
function stopDone(stop) {
  if (stop.kind === 'collect') {
    // Weight comes from the bags now, but the order total is still what says
    // the pickup is priced and finished with.
    return Boolean(stop.order.collected_at) && stop.order.weight_lb != null;
  }
  if (stop.kind === 'deliver') {
    return Boolean(stop.order.delivered_at);
  }
  if (stop.kind === 'dropoff') {
    return (stop.orders || []).every((o) => o.status === 'AT_PARTNER');
  }
  if (stop.kind === 'pickup_partner') {
    // Collecting finished bags back off a laundromat IS the load-out pass, and
    // that screen already exists and already does it properly - scan every bag
    // out, build the run, load in reverse. Rebuilding a worse version of it
    // here would be two ways to do one job.
    return (stop.orders || []).every((o) => o.loaded_at);
  }
  return false;
}

// A link that opens whatever maps app the phone actually has.
//
// A plain https://maps.google.com/?q=... rather than a geo: or maps:// scheme.
// Those open the native app directly but do nothing at all on a phone that does
// not have that particular app, and a dead button on a doorstep is worse than
// one extra tap. Android opens Google Maps from this, iOS offers a choice, and
// every phone can at least show it.
function mapLink(address) {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

function addressOf(who) {
  if (!who) return '';
  return [who.address_line1, who.address_line2, who.city, who.state, who.postal_code]
    .filter(Boolean)
    .join(', ');
}

// WHAT HE HAS ALREADY DONE TODAY.
//
// The routing board is built from live queries, so a stop disappears from it
// the moment it is finished - which is right for a board answering "what is
// left" and useless for a run answering "where am I". Without this the count
// read "stop 1 of 4" all morning and never moved, and the page could not tell
// that the visit he just finished was at the same address as the next one.
//
// Only today's, and only this driver's. Yesterday's round is not part of this
// morning's progress bar.
async function doneToday(driverId, dateIso) {
  const from = `${dateIso}T00:00:00`;

  let query = db
    .from('orders')
    .select(
      'id, order_number, status, bag_count, weight_lb, collected_at, at_partner_at, ' +
        'delivered_at, partner_id, customers(name, address_line1, address_line2, city, state, postal_code)'
    )
    .or(`collected_at.gte.${from},delivered_at.gte.${from}`);

  if (driverId) query = query.eq('driver_id', driverId);

  const { data, error } = await query;
  if (error) throw error;

  const stops = [];

  for (const order of data || []) {
    // The same order is two different stops in a day - the door to collect it,
    // the door again to deliver it - so it can legitimately appear twice.
    if (order.collected_at >= from && order.weight_lb != null) {
      stops.push({ kind: 'collect', order, leg: 1 });
    }
    if (order.at_partner_at && order.at_partner_at >= from) {
      stops.push({ kind: 'dropoff', order, partnerId: order.partner_id, leg: 2 });
    }
    if (order.delivered_at && order.delivered_at >= from) {
      stops.push({ kind: 'deliver', order, leg: 3 });
    }
  }

  return stops;
}

// The whole run for one driver, and which stop they are on.
async function forDriver(driverId) {
  const now = booking.nowInService();
  const board = await dispatch.board(now.date, now.time, driverId);

  const describe = (stop) => ({
    ...stop,
    address: stop.order ? addressOf(stop.order.customers) : addressOf(stop.partner),
    name: stop.order ? null : stop.partner ? stop.partner.name : 'a laundromat',
  });

  // Several finished bags handed to one laundromat was one visit, not four, so
  // they collapse into a single done stop the way the live board groups them.
  const finished = await doneToday(driverId, now.date);
  const drops = finished.filter((s) => s.kind === 'dropoff');
  const collapsedDrops = drops.length
    ? [
        {
          kind: 'dropoff',
          bags: drops.length,
          orders: drops.map((s) => s.order),
          partner: (board.partners || []).find((p) => p.id === drops[0].partnerId) || null,
        },
      ]
    : [];

  const behind = [
    ...finished.filter((s) => s.kind === 'collect'),
    ...collapsedDrops,
    ...finished.filter((s) => s.kind === 'deliver'),
  ].map((stop) => ({ ...describe(stop), done: true }));

  const ahead = board.stops.map((stop) => ({ ...describe(stop), done: stopDone(stop) }));

  const stops = [...behind, ...ahead];

  // WHICH BAGS AM I HANDING OVER. The laundromat stop knows which orders are
  // going there; the driver needs the numbers clipped to them, because that is
  // what he and the counter assistant can actually say out loud.
  for (const stop of stops) {
    const orders =
      stop.orders || (stop.kind === 'deliver' && stop.order ? [stop.order] : null);
    if (!orders) continue;

    const numbers = [];
    for (const order of orders) {
      const labels = await bags.forOrder(order.id);
      numbers.push(...bags.clipsFor(labels));
    }
    stop.clips = numbers.sort((a, b) => a - b);
  }

  // The one he is on: the first that is not finished. Not "the next one after
  // the last finished", because a stop can be completed out of order - somebody
  // ringing ahead, a building that would not open - and skipping back to the
  // unfinished one is right in every case.
  const current = stops.find((s) => !s.done) || null;

  // Arrival hangs on the order. A laundromat stop has no order of its own, so
  // it borrows the first bag going there - they arrive together, and there is
  // no case where he is at the door for one and not the other.
  const arrivalOrder = current
    ? current.order || (current.orders || [])[0] || null
    : null;

  // ALREADY STANDING THERE.
  //
  // If the stop before this one is finished and was at the same address, he has
  // not moved - so asking him to tap "I'm here" again, or offering to navigate
  // him to where he is, is nonsense. It happens on every laundromat visit,
  // where dropping the dirty bags off and collecting the finished ones are two
  // stops at one door, and it happens for two customers in the same building.
  const index = current ? stops.indexOf(current) : -1;
  const previous = index > 0 ? stops[index - 1] : null;
  const stillThere = Boolean(
    previous && previous.done && current.address && previous.address === current.address
  );

  const arrived = stillThere || Boolean(arrivalOrder && arrivalOrder.arrived_at);

  let tasks = [];
  if (current && arrived) {
    if (current.kind === 'collect') tasks = await tasksForCollect(current.order);
    else if (current.kind === 'deliver') tasks = await tasksForDeliver(current.order);
  }

  // The one thing to do right now. Everything before it is done and everything
  // after it is waiting on it, so the page only ever has to draw this one.
  const task = tasks.find((t) => !t.done) || null;

  return {
    date: board.date,
    driver: board.driver,
    base: board.base,
    stops,
    current,
    arrivalOrder,
    arrived,
    stillThere,
    tasks,
    task,
    done: stops.filter((s) => s.done).length,
    total: stops.length,
    finished: stops.length > 0 && !current,
    mapLink: current && current.address ? mapLink(current.address) : null,
  };
}

// "I'm here." Sets the flag on whichever order carries this stop's arrival.
async function arrive(orderId) {
  const { error } = await db
    .from('orders')
    .update({ arrived_at: new Date().toISOString() })
    .eq('id', orderId);

  if (error) throw error;
}

// Cleared whenever a step completes, so the next stop starts at "go here"
// rather than believing he is still standing at the last one.
async function leave(orderId) {
  const { error } = await db.from('orders').update({ arrived_at: null }).eq('id', orderId);
  if (error) throw error;
}

module.exports = {
  forDriver,
  arrive,
  leave,
  mapLink,
  addressOf,
  stopDone,
  tasksForCollect,
  tasksForDeliver,
};
