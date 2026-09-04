'use strict';

const db = require('../db');
const dispatch = require('./dispatch');
const booking = require('./booking');
const bags = require('./bags');
const loadout = require('./loadout');
const { sendAndLog } = require('./notify');

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
// Then one bag at a time - tag on it, then on the scale -
// and on to the next. Then they go in the van.
//
// The old order asked for stickers before anybody had said how many bags there
// were, and then for one total weight at the end, which asks him to add up in
// his head and loses which bag was the heavy one.
async function tasksForCollect(order) {
  // PICKUP labels only. A delivery sticker bound later at the laundromat is not
  // a spare bag at this door, and counting it here would make the collect stop
  // look like it had one more bag than the driver is standing in front of.
  const labels = await bags.forOrder(order.id, 'PICKUP');
  const known = order.bag_count != null;
  const bagCount = Number(order.bag_count || 0);

  // NEIL'S SEQUENCE, AND THE ORDER OF IT IS THE POINT.
  //
  //   1. take the bags       2. tag each one      3. weigh each one      4. load
  //
  // Collecting comes FIRST, before anything is tagged or weighed. That is the
  // real order of events at a door: he is handed the bags and then deals with
  // them. Marking it collected is also what tells the customer we have been,
  // and making that wait until the last bag is on the scale would delay their
  // text for no reason.
  //
  // The screen shows exactly one of these at a time and refuses to show the
  // next until the one before it is done, which is what stops the doorstep
  // shortcut: a driver who can see the weight box before he has tagged the bag
  // will use it, and then nobody knows which bag weighed what.
  const tasks = [
    {
      key: 'collected',
      title: order.collected_at
        ? 'Collected'
        : known
          ? `Collect ${bagCount} bag${bagCount === 1 ? '' : 's'}`
          : 'Collect the bags',
      // NO SUPPORTING LINE. Neil deleted it off the screen himself: the button
      // says "I have the bags", and that it also texts the customer is our
      // plumbing, not his instruction.
      detail: null,
      spot: spotOf(order),
      spotLabel: 'The bags are here',
      done: Boolean(order.collected_at),
    },
    {
      key: 'bag_count',
      // A STATEMENT, NOT A QUESTION. The card reads "TASK: ... for order #1940",
      // and a question mark landing in the middle of that made a sentence out
      // of two halves that do not join. Neil's wording.
      title: known
        ? `${bagCount} bag${bagCount === 1 ? '' : 's'}`
        : 'Enter the number of bags collected',
      // No supporting line. Neil deleted it off the screen: the task says to
      // enter the number of bags collected, and how the screen behaves next is
      // ours to worry about.
      detail: null,
      done: known,
    },
  ];

  // TWO STEPS PER BAG, NOT ONE. Tag it, then weigh it.
  //
  // They used to be a single task that was only done once the bag was both
  // labelled and weighed, which reads fine on a list and badly on a doorstep:
  // it gave no separate instruction for the tag, and a driver who had stuck one
  // on saw the same unfinished line as one who had not.
  //
  // The photo stays part of weighing rather than a step of its own, because it
  // is one form - splitting them would let a weight be recorded with nothing
  // behind it.
  for (let position = 1; position <= bagCount; position += 1) {
    const label = labels.find((l) => l.position === position) || null;

    tasks.push({
      key: `tag_${position}`,
      position,
      label,
      title: label
        ? `Bag #${position} tagged - ${label.code}`
        : `Put a Bag Tag on Bag #${position}`,
      // The rest of Neil's sentence, which sits after the order number. Only
      // while there is nothing on the bag yet - once it is tagged the step is
      // done and reads as a record of it, not an instruction.
      titleTail: label ? null : '& scan the QR code on the bag tag',
      // No supporting line, and no note about the code format under the box.
      // Both deleted off the screen by Neil: the task already says to tag the
      // bag and scan it, and the field is labelled.
      detail: null,
      done: Boolean(label),
      needsLabel: !label,
    });

    tasks.push({
      key: `weigh_${position}`,
      position,
      label,
      title:
        label && label.weight_lb != null
          // THE TAG, NOT THE POSITION. Neil: "6ZP4DN - 30 lb". Once a bag has
          // been weighed the useful record of it is the sticker it carries -
          // that is what a laundromat reads back and what the report joins on.
          ? `${label.code} - ${label.weight_lb} lb`
          // NAMED BY ITS TAG, NOT ITS POSITION. Neil: "Weigh Bag with Tag ID
          // 6ZP4DN." The sticker is on the bag in his hands; "#1" is a place
          // in a count he has to keep in his head. The code is in the title so
          // run-page.js can link it where it stands, and so the checklist
          // entry underneath is the same sentence.
          : label
            ? `Weigh Bag with Tag ID ${label.code}`
            : `Weigh Bag #${position}`,
      // The "with Tag ID 6ZP4DN." half of the line is built in run-page.js,
      // because the id is a link to that sticker's page and a link is markup.
      // The label is already on this task, which is all it needs.
      // No supporting line - deleted off the screen by Neil. The step is
      // "weigh bag 1"; what the number then does is the system's business.
      detail: null,
      done: Boolean(label && label.weight_lb != null),
      // Cannot weigh a bag that has nothing on it: the weight is recorded
      // against the tag, so there is nowhere to put the number.
      blockedBy: label ? null : 'tag',
    });

    // THREE STEPS PER BAG, NOT TWO. Tag it, weigh it, CLIP it.
    //
    // The clip used to be assigned silently at the scale and mentioned once at
    // the end, inside "Clips 1 on, then load them". Neil walked a real order
    // and was never told to put a clip on anything - the number existed in the
    // database and nowhere in his hands. A step nobody is shown is a step that
    // does not happen.
    //
    // It is per bag because the clip is per bag. One confirmation, naming the
    // number, on the bag he is holding right now - not a list of numbers at the
    // end to be matched up against bags already in the van.
    tasks.push({
      key: `clip_${position}`,
      position,
      label,
      // ON THE TAG, NOT ON "BAG #1". Neil's sentence: "Put Van Clip #1 on Tag ID
      // 6ZP4DN." The tag is the bag's identity - it is stuck to it - where the
      // bag number is a position in a count that exists only on this screen.
      // With two bags in his arms the sticker is the thing he can actually
      // check against.
      //
      // The code is in the title rather than added by the page, so the
      // checklist entry underneath is a whole sentence too; run-page.js turns
      // that code into the link.
      title:
        label && label.clipped_at
          // The finished entry is a record, so it is shorter than the
          // instruction: "Van Clip #1 on 6ZP4DN". The words "Tag ID" are there
          // to tell him what to look for; once it is done, the code alone says
          // which bag it went on.
          ? `Van Clip #${label.clip_number} on ${label.code}`
          : label && label.clip_number != null
            ? `Put Van Clip #${label.clip_number} on Tag ID ${label.code}`
            : `Clip Bag #${position}`,
      // The task line says which clip on which bag; the number is on screen
      // at 40px. There is nothing left for a line underneath to add.
      detail: null,
      done: Boolean(label && label.clipped_at),
      clip: label ? label.clip_number : null,
      // The clip is handed out by weighing, so there is nothing to put on until
      // the bag has been on the scale.
      blockedBy: label && label.weight_lb != null ? null : 'weigh',
    });

    // FOUR STEPS PER BAG: tag, weigh, clip, LOAD.
    //
    // Neil's sequence, said in full: "bag one tagged, and then bag one twenty
    // five pounds, and then bag one van clip one, and then put bag on van, and
    // then on bag two." He deals with ONE BAG COMPLETELY and then picks up the
    // next, which is what a person actually does at a door with their hands
    // full - not four bags tagged, then four weighed, then four loaded.
    //
    // It also means a bag is never left standing on a porch while its
    // neighbour is being weighed, which is the failure the old one-tap-at-the-
    // end version could not see.
    tasks.push({
      key: `load_${position}`,
      position,
      label,
      // BY ITS CLIP, NOT ITS BAG NUMBER. Neil's wording, and it is the right
      // name at this moment: the clip went on a step ago and is now what the
      // bag is called for the rest of the van leg - it is what he reads off the
      // load and what he says at a laundromat counter. "Bag 1" is a position
      // in a count nobody can see once the bag is in his arms.
      //
      // The bag number survives where there is no clip yet, which cannot
      // normally happen - the step is blocked until it is clipped - but a
      // heading that says "Van Clip #null" would be worse than a plain one.
      title:
        label && label.loaded_at
          ? label.clip_number != null
            ? `Van Clip #${label.clip_number} on the van`
            : `Bag #${position} in the van`
          : label && label.clip_number != null
            ? `Put Van Clip #${label.clip_number} on the van`
            : `Put Bag #${position} in the van`,
      detail: null,
      done: Boolean(label && label.loaded_at),
      clip: label ? label.clip_number : null,
      // Nothing goes in the van without its clip on, because the clip is the
      // only way it gets found again.
      blockedBy: label && label.clipped_at ? null : 'clip',
    });
  }

  // THE LAST STEP, AND IT IS NOT THE SAME AS THE LAST BAG BEING WEIGHED.
  //
  // Clips are handed out when a bag goes on the scale, so by here the system
  // already knows the numbers - what it does not know is whether the bags are
  // actually in the van. That gap is exactly where one gets left on a porch,
  // which is the whole reason this step exists rather than being assumed.
  const clips = bags.clipsFor(labels);
  const everyBagDone = bagCount > 0 && tasks.slice(2).every((t) => t.done);

  // ONLY WHERE THERE ARE NO BAGS TO WALK. With a bag count the loading is done
  // one bag at a time above, and this would be a second tap that means the same
  // thing - the order-level stamp is written by the last bag going aboard.
  //
  // It survives for the case where the count is not known yet, so the sequence
  // still has an end rather than trailing off.
  if (!bagCount) {
    tasks.push({
      key: 'van',
      title: order.van_confirmed_at ? 'In the van' : 'Put them in the van',
      detail: 'Tap this once all of them are actually in the van.',
      done: Boolean(order.van_confirmed_at),
      clips,
      blockedBy: everyBagDone ? null : 'bags',
    });
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// THE WHOLE ORDER, ONE TASK AT A TIME.
//
// NEIL'S RULE, extended past the doorstep: "There should only be one thing
// that I can do at a specific time... there's a specific task to do. The
// person doing that task has to click a confirmation that says that task is
// done to get to the next task."
//
// The order page used to show every legal transition at once - Dropped at
// partner AND Out for delivery, side by side, with a weight box under them.
// Both were legal, because the laundromat leg is optional in the state
// machine, so the page offered a choice where the day has a sequence.
//
// WHY THE CHOICE COLLAPSED. Since 0048 every order is PLANNED to a laundromat
// when it is booked, so "is this going to a partner" is a fact on the order
// rather than a question for whoever is looking at the screen. An order with a
// laundromat goes to it; an order with none goes straight back out. Either way
// there is one next thing.
//
// It reads the state machine rather than restating it - orders.ALLOWED_NEXT
// still decides what is legal, and every button posts to the route it always
// posted to. This only picks which one of them to show.
// ---------------------------------------------------------------------------

async function tasksAfterPickup(order) {
  const tasks = [];
  const partnerBound = Boolean(order.partner_id || order.intended_partner_id);

  // --- to the laundromat ----------------------------------------------------
  if (partnerBound) {
    tasks.push({
      key: 'at_partner',
      title: order.at_partner_at ? 'Handed to the laundromat' : 'Hand it to the laundromat',
      detail: 'Take the clips off as you hand them over - those numbers go back in the van.',
      done: Boolean(order.at_partner_at) || ['READY', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status),
    });

    // WHAT THE LAUNDROMAT HAS PACKED SO FAR, off their own sticker taps. It is
    // their declaration, not our count - nothing here is in the van.
    const packed = (await bags.forOrder(order.id, 'DELIVERY')).filter((b) => b.sticker_seq);
    const finished = packed.filter((b) => b.finished_at);

    tasks.push({
      key: 'ready',
      title:
        order.status === 'AT_PARTNER'
          ? finished.length
            ? `Laundromat has ${finished.length} bag${finished.length === 1 ? '' : 's'} ready`
            : 'Waiting on the laundromat'
          : 'Laundromat has finished',
      detail:
        'They tap each sticker as they pack it. Mark it here if they tell you instead.',
      done: ['READY', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status),
      packed,
      finished,
    });

    // --- what came back ------------------------------------------------------
    //
    // Before anything moves and before the customer is told anything. A real
    // order once went out, and its customer was texted, while nobody had yet
    // recorded what came off the shelf.
    tasks.push({
      key: 'return',
      title:
        order.return_bag_count != null
          ? `${order.return_bag_count} bag${order.return_bag_count === 1 ? '' : 's'} back, ${Number(order.return_weight_lb || 0).toFixed(1)} lb`
          : // IT IS A COLLECTION FIRST AND A WEIGHING SECOND, and the title now
            // says so. "Weigh what came back" read as though the bags were
            // already in the van - the driver still has to drive there and
            // pick them up, and that is the actual next thing he does.
            finished.length
            ? `Collect ${finished.length} bag${finished.length === 1 ? '' : 's'} from the laundromat and weigh them`
            : 'Collect from the laundromat and weigh what came back',
      detail:
        'At their counter, before anything moves. Ask how many bags and what they weigh - it is checked against what you collected, and only then do the clips go on.',
      done: order.return_bag_count != null,
      finished,
    });
  }

  // --- back out to the door -------------------------------------------------
  tasks.push({
    key: 'out',
    title: order.status === 'OUT_FOR_DELIVERY' || order.status === 'DELIVERED'
      ? 'Out for delivery'
      : 'Load it and set off',
    detail: 'The customer is texted that it is on its way.',
    done: ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status),
  });

  // --- the door -------------------------------------------------------------
  const scan = await loadout.allBagsScanned(order);

  tasks.push({
    key: 'scan',
    title: scan.allScanned ? 'Bags checked' : 'Scan every bag at the door',
    detail: 'The scan is a confirmation, not a search. It agrees or it shouts.',
    done: Boolean(scan.allScanned),
    scan,
  });

  tasks.push({
    key: 'delivered',
    title: order.status === 'DELIVERED' ? 'Delivered' : 'Drop the bags off',
    // The spot is its own line on the card now, so saying it here too would be
    // the same sentence twice on one screen.
    detail: 'Photograph them where you leave them. This charges the card.',
    spot: spotOf(order),
    spotLabel: 'Leave them here',
    done: order.status === 'DELIVERED',
    blockedBy: scan.allScanned ? null : 'scan',
  });

  return tasks;
}

// Every task for an order, from the doorstep to the doorstep. The pickup half
// only while the bags are still at the customer's door; after that the rest.
async function tasksForOrder(order) {
  const pickup = await tasksForCollect(order);
  const rest = await tasksAfterPickup(order);
  return [...pickup, ...rest];
}

// AT THE DOOR: FIND THEM BY CLIP, STRIP THEM, LEAVE THEM, PHOTOGRAPH THEM.
//
// NEIL'S SEQUENCE, and it replaces scanning every bag. The scan was there to
// prove the driver had the right bags - but by this point the CLIP already
// says which bags these are, he is about to take the bag tag off anyway, and
// scanning a tag seconds before binning it proves nothing the number on the
// clip did not already prove.
//
// What the scan cannot do and the clip can: be read across a van without
// unpacking it. "Clips 1 and 2" is how he finds them.
//
// STRIPPING IS A REAL STEP, not tidying. The bag tag is ours and the
// laundromat's own ticket is theirs; either one left on a bag walks a
// stranger's name, an order id and a laundromat's internal tracking into a
// customer's house. It is also how a used tag gets back out of circulation.
async function tasksForDeliver(order) {
  const mine = await bags.forOrder(order.id, 'DELIVERY');
  const aboard = mine.filter((b) => b.loaded_at);

  const clips = bags.clipsFor(aboard);
  const clipsOff = aboard.length > 0 && clips.length === 0;
  const stripped = aboard.length > 0 && aboard.every((b) => b.released_at);

  return [
    // NO "MARK IT OUT FOR DELIVERY" STEP HERE, and that is Neil's call after
    // seeing one: "I shouldn't have to put the bags in the van, drive to a
    // stop, then mark them as out for delivery."
    //
    // He is right, and it is the same principle as everywhere else on this
    // screen: a step exists because somebody has to DO something. Setting off
    // is not an act at a doorstep - it already happened, at the laundromat,
    // when the last bag came off their counter. So the system records it there
    // (in /ops/run/collected-all) and the door goes straight to the work.
    //
    // A step that only asks the driver to tell the system what it could have
    // worked out itself is a step that should not exist.
    {
      key: 'clips',
      title: clipsOff
        ? 'Bags out of the van'
        : clips.length
          ? `Take clips ${clips.join(', ')} out`
          : 'Take the bags out',
      detail: 'Set them apart from the load. Those numbers go back in the van.',
      done: clipsOff,
      clips,
    },
    {
      key: 'strip',
      title: stripped ? 'Tags off' : 'Take the bag tags off',
      detail: "Ours and the laundromat's. Neither goes into a customer's house.",
      done: stripped,
      blockedBy: clipsOff ? null : 'clips',
    },
    {
      key: 'delivered',
      // SAY WHAT TO DO, THEN WHERE. Neil: "there is unnecessary wording on each
      // of these steps, it should be straightforward."
      //
      // "Leave them, photograph them, done" is three instructions in a title,
      // and "where the customer asked" TOLD him there was a spot without ever
      // saying what it was - the one piece of information he actually needed at
      // that door was the one thing the screen withheld.
      title: 'Drop the bags off',
      detail: 'Photograph them where you leave them.',
      spot: spotOf(order),
      spotLabel: 'Leave them here',
      done: Boolean(order.delivered_at),
      blockedBy: stripped ? null : 'strip',
    },
  ];
}

// WHERE THE CUSTOMER ASKED FOR IT, in their own words.
//
// dropoff_spot is the field the AI saves it to; special_instructions is the
// older one and plenty of live customers still only have that. Both are read,
// newest first, because a spot that exists and is not shown is worse than no
// spot at all - the driver guesses, and the guess is a doorstep.
//
// ONE SPOT SERVES BOTH LEGS. The customer is asked "where should the driver
// pick the laundry up and drop it back off?" - one answer, two visits. It was
// only ever shown on the way back OUT, which left the driver standing at the
// collection door with an address and nothing else, next to a bag sitting
// exactly where the customer had said it would be.
//
// The order's own snapshot wins over the customer row for the same reason it
// does everywhere else: this is what THIS order was booked with.
function spotOf(order) {
  const own = order.preferences && Object.keys(order.preferences).length ? order.preferences : null;
  const prefs = own || (order.customers && order.customers.preferences) || {};

  const spot = String(prefs.dropoff_spot || prefs.special_instructions || '').trim();
  if (!spot) return null;

  // Customers type "front door", not "Front door", and this is read at a run.
  return spot.charAt(0).toUpperCase() + spot.slice(1);
}

// Is this stop finished?
function stopDone(stop) {
  if (stop.kind === 'collect') {
    // NOT `weight_lb != null`. That column is the SUM of the bag weights and is
    // recomputed as each bag is weighed, so on a two-bag order it stops being
    // null after bag 1 - and this said the door was finished. The run then
    // moved to the next address with bag 2 untagged, unweighed and unclipped.
    //
    // van_confirmed_at is the last doorstep task and is blocked until every bag
    // is tagged and weighed, so it means what this test needs it to mean.
    return Boolean(stop.order.collected_at) && Boolean(stop.order.van_confirmed_at);
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
// Only today's, and only this driver's. Yesterday's route is not part of this
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
async function forDriver(driverId, roundStart = null) {
  const now = booking.nowInService();
  // NO TIME PASSED, ON PURPOSE. board() works out a sensible start itself and
  // falls forward to the first pickup window when the clock is outside the
  // working day. Handing it now.time defeated that: opened at half past
  // midnight the run asked which laundromat was open at 00:38, got the correct
  // answer of "none", and drew a drop-off stop for "a laundromat" with no
  // address and an "I'm here" button for a place it could not name.
  // ROUNDSTART IS THE CARD HE TAPPED. Null means "wherever I am", and board()
  // then picks the earliest route that has started and still has work in it -
  // which is what a driver means by "the route I am on", clock or no clock.
  const board = await dispatch.board(now.date, roundStart, driverId);

  // WHICH ROUTE HE IS IN, AND WHICH ONES HE HAS BEEN THROUGH.
  //
  // Worked out by board() alongside the filtering, so the cards and the stops
  // below them can never describe two different routes. Recomputing them here
  // was the first version and is exactly the drift this codebase keeps warning
  // about.
  const routes = board.routes || [];

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
  // ONE QUERY FOR EVERY LABEL ON THE ROUTE, rather than one per order inside
  // two nested loops. That was seven bag_labels route trips on a three-stop
  // route, and each one is a network hop - most of the delay between tapping a
  // bag at a counter and watching it turn green.
  const everyOrderId = stops.flatMap((st) =>
    (st.orders || (st.order ? [st.order] : [])).map((o) => o.id)
  );
  const labelsByOrder = await bags.forOrders(everyOrderId);

  for (const stop of stops) {
    const orders =
      stop.orders || (stop.kind === 'deliver' && stop.order ? [stop.order] : null);
    if (!orders) continue;

    const numbers = [];
    let aboard = 0;
    for (const order of orders) {
      const labels = labelsByOrder.get(order.id) || [];
      numbers.push(...bags.clipsFor(labels));
      // PICKUP bags that are actually in the van. A delivery sticker bound
      // later at the laundromat is not something we are carrying in.
      aboard += labels.filter((l) => l.leg === 'PICKUP' && l.loaded_at).length;
    }
    stop.clips = numbers.sort((a, b) => a - b);

    // BAGS ARE BAGS, NOT ORDERS. The laundromat stop said "2 bags, 90 lb" over
    // three clips, because the count was needsWash.length + pickups.length -
    // one per ORDER. A driver handing over three bags reads that as being one
    // short and starts looking for a bag that was never missing.
    //
    // Counted here rather than in dispatch because this is where the labels are
    // already loaded; dispatch has the orders and would have to fetch them
    // again to answer the same question.
    if (stop.kind === 'dropoff' && aboard) stop.bags = aboard;
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
    routes,
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

    // HAS HE SET OFF? "I'm here" is gated behind the directions being opened,
    // so arrival cannot be confirmed at a place nobody drove to.
    //
    // Already standing there counts. Every laundromat visit is two stops at
    // one door, and a driver who has just handed the dirty bags over is not
    // going to navigate to where his feet are.
    navigating: Boolean(stillThere || (arrivalOrder && arrivalOrder.navigating_at)),
  };
}

// "Take me there." Records that the driver opened the directions, so the
// arrival button can appear. Best effort: failing to record this must never
// stop somebody getting directions.
async function setOff(orderId) {
  // CLAIMED WITH THE UPDATE ITSELF. The row only comes back when navigating_at
  // was still null, so the message below cannot go out twice - not on a double
  // tap, and not on the "Directions again" button, which is the same link.
  //
  // Nothing reads the timestamp's value, only whether it is set, so not
  // refreshing it on a second tap costs nothing.
  const { data: claimed, error } = await db
    .from('orders')
    .update({ navigating_at: new Date().toISOString() })
    .eq('id', orderId)
    .is('navigating_at', null)
    .select('id, collected_at, preferences, customers(id, phone, status, preferences)')
    .maybeSingle();

  if (error) {
    console.error(`Could not record setting off: ${error.message}`);
    return;
  }

  if (!claimed) return;

  // THE PICKUP LEG ONLY. Neil asked for the one at the start of the day: we
  // are on our way for your laundry, and we will say when we have it. Once
  // collected_at is set the same button is taking the driver to a laundromat
  // or back to a door with clean laundry - the second of those is already
  // covered by the out-for-delivery text, and the first is not the customer's
  // business.
  if (claimed.collected_at) return;

  const customer = claimed.customers;
  if (!customer || !customer.phone) return;

  // STOP MEANS STOP, and a new message does not get to be the exception.
  if (customer.status === 'UNSUBSCRIBED') return;

  await sendAndLog(customer.phone, onTheWayMessage(claimed), customer.id);
}

// One segment of plain ASCII, and the spot in the customer's own words rather
// than ours - "from where you said" so that whatever they typed reads as the
// instruction it is. A real saved spot can be a sentence ("Deliver to 16-51
// Chandler Dr"), so nothing is wrapped around it that assumes a short phrase.
//
// A COMMA, NOT A SPACED DASH. notify.toPlainText() rewrites " - " to ", " on
// its way out - no dashes in a LYNDRY text - so writing the dash here would
// mean the source said one thing and the customer read another.
function onTheWayMessage(order) {
  const spot = spotOf(order);

  return spot
    ? `We're on our way to pick up your laundry from where you said, ${spot}. We'll text you once we have it.`
    : "We're on our way to pick up your laundry. We'll text you once we have it.";
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
  const { error } = await db
    .from('orders')
    .update({ arrived_at: null, navigating_at: null })
    .eq('id', orderId);
  if (error) throw error;
}

module.exports = {
  forDriver,
  arrive,
  leave,
  mapLink,
  setOff,
  addressOf,
  stopDone,
  tasksForCollect,
  tasksAfterPickup,
  tasksForOrder,
  tasksForDeliver,
};
