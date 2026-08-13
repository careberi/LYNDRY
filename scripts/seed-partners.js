'use strict';

// ---------------------------------------------------------------------------
// Laundromats across the service area, so partner choice has real trade-offs.
//
//   npm run seed:partners             what it would create
//   npm run seed:partners -- --write  actually create it
//   npm run seed:partners -- --clear  remove them again
//
// With two partners the cheapest-all-in decision is nearly always the same one.
// With eight spread from Ridgewood to Jersey City, and rates, capacities,
// turnarounds and cutoffs that genuinely differ, the cost model has to work for
// its answer - and a driver in Hoboken stops being sent to Bergen County.
//
// THE NAMES ARE INVENTED AND SAY SO. Every row carries a note on its own page
// making clear it is seeded and that no agreement exists. This follows the same
// rule the planner's seed data already follows: a plausible laundromat name
// with a wholesale rate next to it gets read as a signed deal within a week,
// and no partner has signed anything.
//
// Coordinates are set directly rather than geocoded - see seed-week.js for why.
// ---------------------------------------------------------------------------

const db = require('../src/db');

const WRITE = process.argv.includes('--write');
const CLEAR = process.argv.includes('--clear');

const NOTE = 'Seeded demo partner. Invented - no agreement exists and no rate has been agreed.';

// Spread deliberately: three in Bergen County, two mid-county, two down the
// Hudson waterfront, one out west. Rates and turnarounds vary so that cheap,
// near and fast are rarely the same place.
// BERGEN COUNTY ONLY, spread across it so cheapest, nearest and fastest are
// rarely the same place. Rates, capacities, turnarounds and cutoffs differ on
// purpose - with them all the same the cost model has nothing to decide.
const PARTNERS = [
  {
    name: 'Fold & Fluff Bergen',
    line: '284 Rock Rd', town: 'Glen Rock', zip: '07452', lat: 40.9631, lng: -74.1305,
    wholesale: 95, retail: 175, capacity: 350, turnaround: 14, cutoff: '17:00',
    open: '07:00', close: '21:00', closedOn: [],
  },
  {
    name: 'Cedar Lane Launderette',
    line: '512 Cedar Ln', town: 'Teaneck', zip: '07666', lat: 40.8981, lng: -74.0172,
    wholesale: 110, retail: 190, capacity: 500, turnaround: 10, cutoff: null,
    open: '06:00', close: '22:00', closedOn: [],
  },
  {
    name: 'Riverside Wash Co',
    line: '148 Main St', town: 'Hackensack', zip: '07601', lat: 40.8865, lng: -74.0448,
    wholesale: 85, retail: 165, capacity: 400, turnaround: 20, cutoff: '15:00',
    open: '07:00', close: '20:00', closedOn: [0],
  },
  {
    name: 'Meadowlands Wash',
    line: '900 Paterson Plank Rd', town: 'Carlstadt', zip: '07072', lat: 40.8237, lng: -74.0554,
    // The cheap one, and slow enough to fail a next-day promise on a late drop -
    // which is exactly the trade-off worth being able to see.
    wholesale: 72, retail: 150, capacity: 600, turnaround: 30, cutoff: '14:00',
    open: '06:00', close: '18:00', closedOn: [0],
  },
  {
    name: 'Palisade Wash House',
    line: '188 Palisade Ave', town: 'Englewood', zip: '07631', lat: 40.8934, lng: -73.9740,
    wholesale: 100, retail: 180, capacity: 450, turnaround: 12, cutoff: '16:30',
    open: '07:00', close: '20:00', closedOn: [],
  },
  {
    name: 'Route 17 Laundry',
    line: '240 Route 17', town: 'Paramus', zip: '07652', lat: 40.9451, lng: -74.0740,
    // Dearest and fastest. Worth it for something collected late that still has
    // to be back tomorrow.
    wholesale: 130, retail: 215, capacity: 250, turnaround: 6, cutoff: null,
    open: '07:00', close: '22:00', closedOn: [],
  },
];

async function clear() {
  const names = PARTNERS.map((p) => p.name);
  const { data: rows } = await db.from('partners').select('id, name').in('name', names);

  for (const row of rows || []) {
    // Orders keep pointing at a partner that is gone only if we let them, so
    // the link is cleared first - "which laundromat had this bag" answered with
    // a dangling id is worse than answered with nothing.
    await db.from('orders').update({ partner_id: null }).eq('partner_id', row.id);
    await db.from('partner_hours').delete().eq('partner_id', row.id);
    await db.from('partners').delete().eq('id', row.id);
  }

  console.log(`  removed ${(rows || []).length} seeded laundromats`);
}

(async () => {
  if (CLEAR) {
    console.log('Removing the seeded laundromats:\n');
    await clear();
    process.exit(0);
  }

  console.log(`${PARTNERS.length} laundromats, Bergen County down to the waterfront:\n`);
  console.log('  ' + 'Name'.padEnd(24) + 'Town'.padEnd(14) + '$/lb'.padStart(6) +
    'Cap'.padStart(7) + 'Turn'.padStart(7) + '  Cutoff');

  for (const p of PARTNERS) {
    console.log(
      '  ' + p.name.padEnd(24) + p.town.padEnd(14) +
      ('$' + (p.wholesale / 100).toFixed(2)).padStart(6) +
      (p.capacity + 'lb').padStart(7) +
      (p.turnaround + 'h').padStart(7) +
      '  ' + (p.cutoff || 'closing time')
    );
  }

  if (!WRITE) {
    console.log('\nNothing was created. Run it again with --write to save.');
    process.exit(0);
  }

  console.log('');

  for (const p of PARTNERS) {
    const row = {
      type: 'LAUNDROMAT',
      name: p.name,
      status: 'ACTIVE',
      address_line1: p.line,
      city: p.town,
      state: 'NJ',
      postal_code: p.zip,
      lat: p.lat,
      lng: p.lng,
      geocoded_at: new Date().toISOString(),
      geocode_failed: false,
      wholesale_per_lb_cents: p.wholesale,
      retail_per_lb_cents: p.retail,
      daily_capacity_lb: p.capacity,
      turnaround_minutes: p.turnaround * 60,
      dropoff_cutoff: p.cutoff,
      hours: p.closedOn.length ? 'Closed Sundays.' : null,
      notes: NOTE,
    };

    const { data: existing } = await db
      .from('partners')
      .select('id')
      .eq('name', p.name)
      .maybeSingle();

    let id;
    if (existing) {
      await db.from('partners').update(row).eq('id', existing.id);
      id = existing.id;
    } else {
      const { data, error } = await db.from('partners').insert(row).select('id').single();
      if (error) throw error;
      id = data.id;
    }

    // The week, rewritten wholesale - the form works the same way, so a day
    // left out is a day closed.
    await db.from('partner_hours').delete().eq('partner_id', id);

    const rows = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      if (p.closedOn.includes(weekday)) continue;
      rows.push({ partner_id: id, weekday, opens_at: p.open, closes_at: p.close });
    }
    if (rows.length) await db.from('partner_hours').insert(rows);

    console.log(`  ${p.name.padEnd(24)}${p.town.padEnd(14)}${rows.length} days open`);
  }

  console.log('\nDone. /ops/routing now has a real choice to make - the cheapest');
  console.log('laundromat, the nearest and the fastest are rarely the same one.');
  console.log('\nEvery one is marked on its page as seeded, with no agreement.');
  console.log('npm run seed:partners -- --clear removes them.');

  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
