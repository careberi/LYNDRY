'use strict';

// ---------------------------------------------------------------------------
// A busy week: orders roughly every hour, today and for the next few days.
//
//   npm run seed:week             what it would create
//   npm run seed:week -- --write  actually create it
//   npm run seed:week -- --clear  remove it again
//
// For seeing how the routing copes with real density rather than six stops.
//
// WHAT THIS WILL AND WILL NOT SHOW YOU. Today's route gets genuinely busy, and
// picking a driver on /ops/routing shows a full day sequenced from their base
// with a laundromat chosen on total cost. Future days can be looked at one at a
// time with ?date=.
//
// It will NOT show tomorrow influencing today. dispatch.board() takes one date
// and knows nothing about the next one, so a laundromat that would be handy for
// tomorrow's cluster gets no credit for that today. That is the rolling horizon
// in ROUTING.md section 6, and it is deliberately not built - it is worth
// nothing until there is exactly this much work, which is why this script
// exists.
//
// COORDINATES ARE SET DIRECTLY, not looked up. Forty addresses through a
// rate-limited public geocoder is forty seconds of hammering somebody else's
// free service for test data. Town centres with a small scatter around them is
// all the routing needs.
//
// Every phone number is in the fictional 555 range.
// ---------------------------------------------------------------------------

const db = require('../src/db');
const booking = require('../src/core/booking');
const bags = require('../src/core/bags');

const WRITE = process.argv.includes('--write');
const CLEAR = process.argv.includes('--clear');

// Where the vans actually go, with a real centre for each town.
const TOWNS = [
  { town: 'Fair Lawn',   zip: '07410', lat: 40.9404, lng: -74.1182, streets: ['Berdan Ave', 'Chandler Dr', 'Morlot Ave', 'Fair Lawn Ave'] },
  { town: 'Glen Rock',   zip: '07452', lat: 40.9629, lng: -74.1291, streets: ['Windham Pl', 'Rock Rd', 'Harristown Rd'] },
  { town: 'Ridgewood',   zip: '07450', lat: 40.9793, lng: -74.1165, streets: ['Chestnut St', 'Franklin Ave', 'Maple Ave'] },
  { town: 'Hawthorne',   zip: '07506', lat: 40.9490, lng: -74.1540, streets: ['Braen Ave', 'Lafayette Ave', 'Goffle Rd'] },
  { town: 'Paramus',     zip: '07652', lat: 40.9445, lng: -74.0754, streets: ['Century Rd', 'Farview Ave', 'Spring Valley Rd'] },
  { town: 'Hackensack',  zip: '07601', lat: 40.8859, lng: -74.0435, streets: ['Main St', 'Prospect Ave', 'Essex St'] },
  { town: 'Teaneck',     zip: '07666', lat: 40.8976, lng: -74.0160, streets: ['Cedar Ln', 'Queen Anne Rd', 'Palisade Ave'] },
  { town: 'Englewood',   zip: '07631', lat: 40.8929, lng: -73.9726, streets: ['Palisade Ave', 'Dean St', 'Grand Ave'] },
  { town: 'Clifton',     zip: '07011', lat: 40.8584, lng: -74.1638, streets: ['Main Ave', 'Van Houten Ave', 'Piaget Ave'] },
  { town: 'Jersey City', zip: '07302', lat: 40.7178, lng: -74.0431, streets: ['Christopher Columbus Dr', 'Grove St', 'Newark Ave'] },
  { town: 'Hoboken',     zip: '07030', lat: 40.7440, lng: -74.0324, streets: ['Washington St', 'Bloomfield St', 'Garden St'] },
  { town: 'Bergenfield', zip: '07621', lat: 40.9276, lng: -73.9974, streets: ['Washington Ave', 'New Bridge Rd'] },
];

const FIRST = ['Ana', 'Ben', 'Clara', 'Dev', 'Elena', 'Femi', 'Grace', 'Hugo', 'Ines', 'Jonah',
  'Kira', 'Luis', 'Maya', 'Nico', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sami', 'Tara',
  'Uma', 'Vic', 'Wes', 'Xena', 'Yuri', 'Zara', 'Aria', 'Bruno', 'Cleo', 'Dante',
  'Esme', 'Finn', 'Gita', 'Hana', 'Iris', 'Jude', 'Kai', 'Lena', 'Milo', 'Nadia'];

const LAST = ['Adeyemi', 'Barros', 'Castellanos', 'Duarte', 'Egwuatu', 'Ferreira', 'Gaspar',
  'Haddad', 'Iyer', 'Jankowski', 'Kowalczyk', 'Lombardi', 'Mensah', 'Novak', 'Oyelaran',
  'Petrov', 'Quintero', 'Rahman', 'Silva', 'Tavares'];

// Deterministic, so two runs make the same people rather than a new crowd.
function scatter(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return (x - Math.floor(x)) - 0.5;
}

const COUNT = 40;

function person(i) {
  const t = TOWNS[i % TOWNS.length];
  return {
    n: 200 + i,
    name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
    line: `${10 + ((i * 13) % 180)} ${t.streets[i % t.streets.length]}`,
    town: t.town,
    zip: t.zip,
    // About half a mile of scatter around the town centre, so stops within a
    // town are not all on top of each other.
    lat: t.lat + scatter(i + 1) * 0.014,
    lng: t.lng + scatter(i + 101) * 0.018,
  };
}

const PEOPLE = Array.from({ length: COUNT }, (_, i) => person(i));
const phoneFor = (n) => `+1201555${String(n).padStart(4, '0')}`;

// Roughly hourly across the working day. Every one lands in a real pickup
// window - booking.windowFor decides which.
const HOURS = ['06:30', '07:30', '08:30', '09:30', '10:30', '11:30', '12:30',
  '13:30', '14:30', '15:30', '16:30', '17:30', '18:30', '19:30', '20:30'];

async function clear() {
  const phones = PEOPLE.map((p) => phoneFor(p.n));

  let removed = 0;
  // In chunks: forty ids in one `in` clause is fine, but this keeps the query
  // predictable if COUNT grows.
  for (let i = 0; i < phones.length; i += 20) {
    const { data: people } = await db
      .from('customers')
      .select('id')
      .in('phone', phones.slice(i, i + 20));

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
      removed += 1;
    }
  }

  const { data: loose } = await db.from('bag_labels').delete().is('order_id', null).select('id');
  console.log(`  removed ${removed} customers, and ${(loose || []).length} unused stickers`);
}

(async () => {
  if (CLEAR) {
    console.log('Removing the busy-week data:\n');
    await clear();
    process.exit(0);
  }

  const today = booking.today();

  // Today is a working day: pickups spread across it AND deliveries going back
  // out, because a real day is both at once. The days after are pickups only -
  // their deliveries have not been earned yet.
  const DAYS = [
    { day: 0, pickups: 14, deliveries: 8 },
    { day: 1, pickups: 14, deliveries: 0 },
    { day: 2, pickups: 12, deliveries: 0 },
    { day: 3, pickups: 10, deliveries: 0 },
  ];

  const totalPickups = DAYS.reduce((t, d) => t + d.pickups, 0);
  const totalDeliveries = DAYS.reduce((t, d) => t + d.deliveries, 0);

  console.log(`${COUNT} customers across ${TOWNS.length} towns.\n`);
  for (const d of DAYS) {
    console.log(
      `  ${booking.readableDate(booking.addDays(today, d.day)).padEnd(16)}` +
        `${String(d.pickups).padStart(2)} pickups` +
        (d.deliveries ? `, ${d.deliveries} deliveries out` : '')
    );
  }
  console.log(`\n  ${totalPickups} pickups and ${totalDeliveries} deliveries in all.`);

  if (!WRITE) {
    console.log('\nNothing was created. Run it again with --write to save.');
    console.log('Run `npm run seed:team -- --write` first if you have not.');
    process.exit(0);
  }

  const { data: team } = await db
    .from('ops_users')
    .select('id, name')
    .eq('role', 'DRIVER')
    .eq('status', 'ACTIVE')
    .order('name');

  if (!team || !team.length) {
    console.log('\nNo drivers. Run `npm run seed:team -- --write` first.');
    process.exit(1);
  }

  const { data: partners } = await db
    .from('partners')
    .select('id')
    .eq('type', 'LAUNDROMAT')
    .eq('status', 'ACTIVE');

  process.stdout.write('\n  customers');

  const ids = [];
  for (const p of PEOPLE) {
    const row = {
      name: p.name,
      phone: phoneFor(p.n),
      address_line1: p.line,
      city: p.town,
      state: 'NJ',
      postal_code: p.zip,
      // Set directly rather than looked up. Forty lookups through a free,
      // rate-limited public geocoder for test data is not a reasonable thing
      // to do to somebody else's service.
      lat: Number(p.lat.toFixed(6)),
      lng: Number(p.lng.toFixed(6)),
      geocoded_at: new Date().toISOString(),
      geocode_failed: false,
      sms_consent_source: 'INBOUND_TEXT',
      sms_consent_at: new Date().toISOString(),
      preferences: {
        water_temp: 'COLD',
        detergent: 'STANDARD',
        fabric_softener: false,
        special_instructions: 'Leave it by the door',
      },
    };

    const { data: existing } = await db.from('customers').select('id').eq('phone', row.phone).maybeSingle();

    if (existing) {
      await db.from('customers').update(row).eq('id', existing.id);
      ids.push(existing.id);
    } else {
      const { data, error } = await db.from('customers').insert(row).select('id').single();
      if (error) throw error;
      ids.push(data.id);
    }
    process.stdout.write('.');
  }

  console.log(` ${ids.length} ready`);

  let made = 0;
  let cursor = 0;
  let partnerTurn = 0;

  for (const spec of DAYS) {
    const date = booking.addDays(today, spec.day);
    process.stdout.write(`  ${booking.readableDate(date).padEnd(16)}`);

    // --- pickups, roughly hourly -------------------------------------------
    for (let i = 0; i < spec.pickups; i += 1) {
      const customerId = ids[cursor % ids.length];
      cursor += 1;

      const time = HOURS[i % HOURS.length];
      const window = booking.windowFor(date, time);
      const driver = team[made % team.length];

      const { error } = await db.from('orders').insert({
        customer_id: customerId,
        driver_id: driver.id,
        status: 'REQUESTED',
        service: 'WASH_DRY_FOLD',
        pickup_date: date,
        pickup_time: time,
        pickup_window_start: window.start,
        pickup_window_end: window.end,
        pickup_method: 'LEAVE_OUTSIDE',
        price_per_lb_cents: 200,
        minimum_cents: 2500,
      });

      // One open pickup per customer per day. A clash just means this customer
      // already has one today, which is fine - move on.
      if (!error) {
        made += 1;
        process.stdout.write('.');
      } else {
        process.stdout.write('-');
      }
    }

    // --- and today, laundry going back out ---------------------------------
    for (let i = 0; i < spec.deliveries; i += 1) {
      const customerId = ids[cursor % ids.length];
      cursor += 1;

      const pounds = 12 + ((i * 7) % 26);
      const partner = partners && partners.length ? partners[partnerTurn++ % partners.length] : null;
      const driver = team[made % team.length];
      const when = (h) => new Date(`${booking.addDays(date, -1)}T${String(h).padStart(2, '0')}:00:00Z`).toISOString();

      const { data: order, error } = await db
        .from('orders')
        .insert({
          customer_id: customerId,
          driver_id: driver.id,
          status: 'OUT_FOR_DELIVERY',
          service: 'WASH_DRY_FOLD',
          pickup_date: booking.addDays(date, -1),
          pickup_time: '10:00',
          pickup_method: 'LEAVE_OUTSIDE',
          bag_count: 1 + (i % 3),
          weight_lb: pounds,
          price_cents: Math.max(2500, pounds * 200),
          price_per_lb_cents: 200,
          minimum_cents: 2500,
          partner_id: partner ? partner.id : null,
          collected_at: when(10),
          at_partner_at: when(12),
          ready_at: when(18),
          loaded_at: when(20),
          stop_number: i + 1,
        })
        .select('id')
        .single();

      if (error) {
        process.stdout.write('-');
        continue;
      }

      // Clipped bags, so the delivery cards read "clips 3, 4" the way a real
      // one would.
      const count = 1 + (i % 3);
      const minted = await bags.mint(count);
      for (let b = 0; b < count; b += 1) {
        await db
          .from('bag_labels')
          .update({
            order_id: order.id,
            position: b + 1,
            bound_at: when(10),
            weight_lb: Math.round((pounds / count) * 10) / 10,
            weighed_at: when(10),
            clip_number: ((i * 3 + b) % 40) + 1,
            clipped_at: when(20),
            loaded_at: when(20),
          })
          .eq('id', minted[b].id);
      }

      made += 1;
      process.stdout.write('o');
    }

    console.log('');
  }

  console.log(`\n  ${made} orders created.`);
  console.log('\n  Look at /ops/routing and pick a driver. ?date= steps through the days.');
  console.log('  Remember: each day is planned on its own - tomorrow does not yet');
  console.log('  influence which laundromat today\'s bags go to. That is ROUTING.md 6.');
  console.log('\n  npm run seed:week -- --clear removes all of it.');

  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
