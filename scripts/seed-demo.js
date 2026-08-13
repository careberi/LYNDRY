'use strict';

// ---------------------------------------------------------------------------
// A whole working day, so every screen has something real on it.
//
//   npm run seed:demo             what it would create
//   npm run seed:demo -- --write  actually create it
//   npm run seed:demo -- --clear  remove it again
//
// Needs `npm run seed:team -- --write` first: the orders are assigned to those
// drivers, and half the point is seeing a round belong to somebody.
//
// EVERY PHONE NUMBER IS FICTIONAL - the 555-0100 range exists for this - so
// nothing here can text a real person however the notify code is configured.
//
// States are written directly rather than pushed through fulfilment.js. That is
// deliberate: fulfilment sends texts and charges cards, and a seed script must
// do neither. The trade is that order_events would be empty, so a few entries
// are written by hand to give the change log something to show.
//
// SAFE TO RUN AGAIN. --clear removes exactly what it made, keyed on the
// customer phone numbers below, and nothing else.
// ---------------------------------------------------------------------------

const db = require('../src/db');
const booking = require('../src/core/booking');
const bags = require('../src/core/bags');
const geocode = require('../src/core/geocode');
const driversCore = require('../src/core/drivers');

const WRITE = process.argv.includes('--write');
const CLEAR = process.argv.includes('--clear');

const PREFS = (spot) => ({
  water_temp: 'COLD',
  detergent: 'STANDARD',
  fabric_softener: false,
  special_instructions: spot,
});

// Real streets across the service area, so the map and the routing have
// somewhere plausible to put everybody.
const PEOPLE = [
  { n: 11, name: 'Bernard Hollis',  line: '71 Braen Ave',      city: 'Hawthorne',   zip: '07506', spot: 'On the porch' },
  { n: 12, name: 'Trey Alvarez',    line: '25 Windham Pl',     city: 'Glen Rock',   zip: '07452', spot: 'Side door' },
  { n: 13, name: 'Priya Raman',     line: '16-50 Chandler Dr', city: 'Fair Lawn',   zip: '07410', spot: 'Behind the screen door' },
  { n: 14, name: 'Dolores Whitby',  line: '210 Main St',       city: 'Hackensack',  zip: '07601', spot: 'Buzz 3B' },
  { n: 15, name: 'Marcus Oyelaran', line: '480 Cedar Ln',      city: 'Teaneck',     zip: '07666', spot: 'Front step' },
  { n: 16, name: 'Ivy Chen',        line: '35 Chestnut St',    city: 'Ridgewood',   zip: '07450', spot: 'Left of the door' },
  { n: 17, name: 'Sam Okafor',      line: '95 Christopher Columbus Dr', city: 'Jersey City', zip: '07302', spot: 'Lobby desk' },
  { n: 18, name: 'Renata Fiore',    line: '120 Washington St', city: 'Hoboken',     zip: '07030', spot: 'Under the stoop' },
];

const phoneFor = (n) => `+1201555${String(n).padStart(4, '0')}`;

// What each order is meant to demonstrate. `stage` drives everything below.
const PLAN = [
  { who: 11, stage: 'to_collect',   day: 0,  bags: 3, note: 'the guided run: count, sticker, weigh, clip' },
  { who: 12, stage: 'to_collect',   day: 0,  bags: 1, note: 'a second pickup on the same round' },
  { who: 15, stage: 'to_collect',   day: 0,  bags: 2, note: 'a different driver' },
  { who: 13, stage: 'upcoming',     day: 1,  bags: 2, note: 'booked for tomorrow' },
  { who: 14, stage: 'in_van',       day: 0,  bags: 2, note: 'weighed and clipped, waiting to go to a laundromat' },
  { who: 16, stage: 'at_partner',   day: -1, bags: 2, note: 'being washed' },
  { who: 17, stage: 'ready',        day: -1, bags: 3, note: 'finished - the load-out pass collects this' },
  { who: 18, stage: 'out',          day: -1, bags: 2, note: 'on the van, clipped, for the delivery flow' },
  { who: 11, stage: 'delivered',    day: -3, bags: 2, note: 'history, paid' },
  { who: 12, stage: 'delivered',    day: -4, bags: 1, note: 'history, still unpaid' },
];

async function clear() {
  const phones = PEOPLE.map((p) => phoneFor(p.n));
  const { data: people } = await db.from('customers').select('id, name').in('phone', phones);

  for (const person of people || []) {
    const { data: orders } = await db.from('orders').select('id').eq('customer_id', person.id);
    for (const o of orders || []) {
      await db.from('order_events').delete().eq('order_id', o.id);
      await db.from('bag_labels').delete().eq('order_id', o.id);
    }
    await db.from('issues').delete().eq('customer_id', person.id);
    await db.from('recurring_schedules').delete().eq('customer_id', person.id);
    await db.from('orders').delete().eq('customer_id', person.id);
    await db.from('messages').delete().eq('customer_id', person.id);
    await db.from('customers').delete().eq('id', person.id);
  }

  console.log(`  removed ${(people || []).length} customers and everything hanging off them`);

  // The stickers this script minted, which are blank again once their orders
  // are gone.
  const { data: loose } = await db.from('bag_labels').delete().is('order_id', null).select('id');
  console.log(`  removed ${(loose || []).length} unused stickers`);
}

(async () => {
  if (CLEAR) {
    console.log('Removing the demo data:\n');
    await clear();
    process.exit(0);
  }

  console.log('A day with something at every stage:\n');
  for (const item of PLAN) {
    const who = PEOPLE.find((p) => p.n === item.who);
    console.log(`  ${item.stage.padEnd(12)}${who.name.padEnd(18)}${item.bags} bag${item.bags === 1 ? '' : 's'}   ${item.note}`);
  }

  if (!WRITE) {
    console.log('\nNothing was created. Run it again with --write to save.');
    console.log('Run `npm run seed:team -- --write` first if you have not.');
    process.exit(0);
  }

  // drivers.active(), not a hand-rolled query - it carries the base columns,
  // and without them every distance ties and the whole county goes to whoever
  // sorts first.
  const team = await driversCore.active();

  if (!team || !team.length) {
    console.log('\nNo drivers. Run `npm run seed:team -- --write` first.');
    process.exit(1);
  }

  const { data: partners } = await db
    .from('partners')
    .select('id, name')
    .eq('type', 'LAUNDROMAT')
    .eq('status', 'ACTIVE');

  console.log('\n--- customers ---');

  const byNumber = new Map();
  for (const p of PEOPLE) {
    const row = {
      name: p.name,
      phone: phoneFor(p.n),
      address_line1: p.line,
      city: p.city,
      state: 'NJ',
      postal_code: p.zip,
      sms_consent_source: 'INBOUND_TEXT',
      sms_consent_at: new Date().toISOString(),
      preferences: PREFS(p.spot),
    };

    const { data: existing } = await db
      .from('customers')
      .select('id')
      .eq('phone', row.phone)
      .maybeSingle();

    let id;
    if (existing) {
      await db.from('customers').update(row).eq('id', existing.id);
      id = existing.id;
    } else {
      const { data, error } = await db.from('customers').insert(row).select('id').single();
      if (error) throw error;
      id = data.id;
    }

    byNumber.set(p.n, id);

    // On the map, one at a time - the geocoder is rate limited.
    const { data: saved } = await db.from('customers').select('*').eq('id', id).single();
    const at = await geocode.locate(saved).catch(() => null);
    console.log(`  ${p.name.padEnd(18)}${p.city.padEnd(14)}${at ? 'on the map' : 'not on the map'}`);
  }

  console.log('\n--- orders ---');

  const today = booking.today();
  let partnerTurn = 0;

  for (const item of PLAN) {
    const customerId = byNumber.get(item.who);
    const who = PEOPLE.find((p) => p.n === item.who);
    const date = booking.addDays(today, item.day);
    const window = booking.windowFor(date, '10:00');

    // NEAREST BASE, the way orders.create() actually assigns. Round-robin gave
    // every driver work but scattered each of them across the whole county,
    // which makes the routing look broken when it is not - a Fair Lawn driver
    // with a Jersey City pickup is a seed-data artefact, not a decision.
    const { data: cust } = await db.from('customers').select('*').eq('id', customerId).single();
    const at = await geocode.locate(cust);
    const best = at ? await driversCore.nearest(at, { drivers: team }) : null;
    const driver = best ? best.driver : team[0];

    const { data: order, error } = await db
      .from('orders')
      .insert({
        customer_id: customerId,
        driver_id: driver.id,
        status: 'REQUESTED',
        service: 'WASH_DRY_FOLD',
        pickup_date: date,
        pickup_time: '10:00',
        pickup_window_start: window.start,
        pickup_window_end: window.end,
        pickup_method: 'LEAVE_OUTSIDE',
        bag_count: item.stage === 'to_collect' || item.stage === 'upcoming' ? null : item.bags,
        price_per_lb_cents: 200,
        minimum_cents: 2500,
      })
      .select('*')
      .single();

    if (error) throw error;

    const stamp = (days, hour) => {
      const d = booking.addDays(today, days);
      return new Date(`${d}T${String(hour).padStart(2, '0')}:00:00Z`).toISOString();
    };

    // Bags, stickers, weights and clips for anything past collection.
    let pounds = 0;
    if (!['to_collect', 'upcoming'].includes(item.stage)) {
      const minted = await bags.mint(item.bags);
      let clip = 0;
      for (let i = 0; i < item.bags; i += 1) {
        const lb = 9 + i * 4.5;
        pounds += lb;
        await db
          .from('bag_labels')
          .update({
            order_id: order.id,
            position: i + 1,
            bound_at: stamp(item.day, 10),
            weight_lb: lb,
            weighed_at: stamp(item.day, 10),
            // A clip only while it is actually in the van.
            clip_number: ['in_van', 'out'].includes(item.stage) ? (clip += 1) : null,
            clipped_at: ['in_van', 'out'].includes(item.stage) ? stamp(item.day, 10) : null,
            loaded_at: item.stage === 'out' ? stamp(item.day, 14) : null,
            released_at: item.stage === 'delivered' ? stamp(item.day, 16) : null,
            delivered_at: item.stage === 'out' ? null : item.stage === 'delivered' ? stamp(item.day, 16) : null,
          })
          .eq('id', minted[i].id);
      }
    }

    const price = pounds ? Math.max(2500, Math.round(pounds * 200)) : null;
    const partner = partners && partners.length ? partners[partnerTurn++ % partners.length] : null;

    const patch = {
      to_collect: {},
      upcoming: {},
      in_van: { status: 'IN_PROCESS', collected_at: stamp(item.day, 10), weight_lb: pounds, price_cents: price },
      at_partner: {
        status: 'AT_PARTNER', collected_at: stamp(item.day, 10), at_partner_at: stamp(item.day, 12),
        weight_lb: pounds, price_cents: price, partner_id: partner ? partner.id : null,
      },
      ready: {
        status: 'READY', collected_at: stamp(item.day, 10), at_partner_at: stamp(item.day, 12),
        ready_at: stamp(item.day, 18), weight_lb: pounds, price_cents: price,
        partner_id: partner ? partner.id : null,
      },
      out: {
        status: 'OUT_FOR_DELIVERY', collected_at: stamp(item.day, 10), at_partner_at: stamp(item.day, 12),
        ready_at: stamp(item.day, 18), weight_lb: pounds, price_cents: price,
        partner_id: partner ? partner.id : null, loaded_at: stamp(0, 8), stop_number: 1,
      },
      delivered: {
        status: 'DELIVERED', collected_at: stamp(item.day, 10), at_partner_at: stamp(item.day, 12),
        ready_at: stamp(item.day, 18), delivered_at: stamp(item.day, 16),
        weight_lb: pounds, price_cents: price, partner_id: partner ? partner.id : null,
        payment_status: item.who === 12 ? 'UNPAID' : 'PAID',
        paid_at: item.who === 12 ? null : stamp(item.day, 16),
      },
    }[item.stage];

    if (Object.keys(patch).length) {
      await db.from('orders').update(patch).eq('id', order.id);
    }

    await db.from('order_events').insert({
      order_id: order.id,
      kind: 'CREATED',
      summary: `Booked for ${booking.readableDate(date)}`,
      actor: 'seed',
    });

    if (pounds) {
      await db.from('order_events').insert({
        order_id: order.id,
        kind: 'WEIGHT',
        summary: `Weighed ${pounds.toFixed(1)} lb across ${item.bags} bag${item.bags === 1 ? '' : 's'}`,
        became: String(pounds.toFixed(1)),
        actor: 'seed',
      });
    }

    console.log(
      `  #${order.order_number}  ${item.stage.padEnd(12)}${who.name.padEnd(18)}` +
        `${driver.name.padEnd(16)}${pounds ? `${pounds.toFixed(1)} lb` : '-'}`
    );
  }

  // --- a thread, an issue and a standing order, so those screens are not blank
  console.log('\n--- conversations, an issue and a standing order ---');

  const chatty = byNumber.get(11);
  const thread = [
    ['INBOUND', 'hey can you grab my laundry tomorrow'],
    ['OUTBOUND', "Of course! We'll be there tomorrow between 9am and 12pm. Just leave it outside and we'll text you as soon as we've got it."],
    ['INBOUND', 'perfect thanks'],
    ['INBOUND', 'actually one of the shirts came back with a mark on it'],
    ['OUTBOUND', "I'm sorry about this. I've passed it to a manager with everything you've told me, and they'll come back to you shortly."],
  ];

  let minute = 0;
  for (const [direction, body] of thread) {
    await db.from('messages').insert({
      customer_id: chatty,
      phone: phoneFor(11),
      direction,
      body,
      status: direction === 'OUTBOUND' ? 'SENT' : 'RECEIVED',
      created_at: new Date(Date.now() - (thread.length - minute) * 6 * 60000).toISOString(),
    });
    minute += 1;
  }
  console.log(`  ${thread.length} messages with ${PEOPLE[0].name}`);

  await db.from('issues').insert({
    customer_id: chatty,
    reason: 'A shirt came back marked. Wants somebody to look at it.',
    status: 'OPEN',
  });
  console.log('  1 open issue');

  await db.from('recurring_schedules').insert({
    customer_id: byNumber.get(13),
    weekday: 2,
    time_of_day: '09:00',
    status: 'ACTIVE',
  });
  console.log(`  1 standing order for ${PEOPLE[2].name}, Tuesdays at 9am`);

  console.log('\nDone. Every ops screen now has something on it.');
  console.log('Run `npm run seed:demo -- --clear` to take it all out again.');

  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
