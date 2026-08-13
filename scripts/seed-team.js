'use strict';

// ---------------------------------------------------------------------------
// Dummy drivers and vans, for trying the system out.
//
//   npm run seed:team            what it would create, and nothing else
//   npm run seed:team -- --write actually create it
//   npm run seed:team -- --clear remove them again
//
// SAFE TO RUN ANY NUMBER OF TIMES. Everything is keyed on a fixed phone number
// per driver, so a second run updates rather than duplicating, and --clear only
// ever removes rows this script made.
//
// THE PHONE NUMBERS ARE DELIBERATELY FICTIONAL. 555-0100 to 555-0199 is the
// range reserved for exactly this, so nothing here can text a real person.
// Nobody can actually sign in as these drivers - a sign-in code would go
// nowhere - which is the point: they exist so the routing, the assignment and
// the round strip have something to work with.
//
// ONE DRIVER, ONE VAN, BERGEN COUNTY. That is the business as it actually is,
// and seed data that pretends otherwise makes every screen read wrong - a round
// spread over three counties is not a round anybody drives.
//
// Adding a second entry here is all it takes to test multi-driver assignment
// again; give them a base in a different part of the county so nearest-base
// has something to distinguish.
// ---------------------------------------------------------------------------

const db = require('../src/db');
const drivers = require('../src/core/drivers');

const WRITE = process.argv.includes('--write');
const CLEAR = process.argv.includes('--clear');

const TEAM = [
  {
    name: 'Dan Reyes',
    phone: '+12015550101',
    // Fair Lawn is roughly the middle of Bergen County, which is what you want
    // from a single van's base - nowhere in the county is far from it.
    base: { line1: '12 Berdan Ave', city: 'Fair Lawn', state: 'NJ', zip: '07410' },
    van: { name: 'Van 1', maxWeightLb: 500, maxBags: 45, clips: 50 },
    wagePerHour: 22,
  },
];


async function clear() {
  const phones = TEAM.map((t) => t.phone);

  const { data: people } = await db.from('ops_users').select('id, name').in('phone', phones);

  for (const person of people || []) {
    // Their orders go back in the pool rather than being deleted - the work is
    // real even when the driver was not.
    await db.from('orders').update({ driver_id: null }).eq('driver_id', person.id);
    await db.from('vehicles').delete().eq('driver_id', person.id);
    await db.from('ops_users').delete().eq('id', person.id);
    console.log(`  removed ${person.name}`);
  }

  if (!people || !people.length) console.log('  nothing to remove.');
}

(async () => {
  if (CLEAR) {
    console.log('Removing the dummy drivers and vans:\n');
    await clear();
    process.exit(0);
  }

  console.log(`${TEAM.length} drivers, one van each:\n`);

  for (const person of TEAM) {
    console.log(
      `  ${person.name.padEnd(18)}${person.base.city.padEnd(14)}` +
        `${person.van.name} - ${person.van.maxWeightLb} lb, ${person.van.maxBags} bags, ${person.van.clips} clips`
    );
  }

  if (!WRITE) {
    console.log('\nNothing was created. Run it again with --write to save.');
    process.exit(0);
  }

  console.log('');

  for (const person of TEAM) {
    const row = {
      name: person.name,
      phone: person.phone,
      role: 'DRIVER',
      status: 'ACTIVE',
      base_address_line1: person.base.line1,
      base_city: person.base.city,
      base_state: person.base.state,
      base_postal_code: person.base.zip,
      wage_cents_hour: person.wagePerHour ? person.wagePerHour * 100 : null,
    };

    const { data: existing } = await db
      .from('ops_users')
      .select('id')
      .eq('phone', person.phone)
      .maybeSingle();

    let id;

    if (existing) {
      await db.from('ops_users').update(row).eq('id', existing.id);
      id = existing.id;
      console.log(`  ${person.name}: already there, updated`);
    } else {
      const { data, error } = await db.from('ops_users').insert(row).select('id').single();
      if (error) throw error;
      id = data.id;
      console.log(`  ${person.name}: added`);
    }

    // One van per driver. Keyed on the driver so a second run replaces rather
    // than piling up a second van for the same person.
    await db.from('vehicles').delete().eq('driver_id', id);
    const { error: vanError } = await db.from('vehicles').insert({
      name: person.van.name,
      driver_id: id,
      max_weight_lb: person.van.maxWeightLb,
      max_bags: person.van.maxBags,
      clip_count: person.van.clips,
      notes: 'Created by npm run seed:team.',
    });
    if (vanError) throw vanError;

    // Put the base on the map. Best effort and one at a time - the geocoder is
    // rate limited to a request a second and a failure here is not worth
    // failing the seed over.
    const { data: saved } = await db.from('ops_users').select('*').eq('id', id).single();
    const located = await drivers.locate(saved).catch(() => null);

    console.log(
      `    ${person.van.name}, base ${person.base.city}` +
        (located && located.base_lat != null ? ' - on the map' : ' - not on the map yet')
    );
  }

  console.log('\nDone. They appear on the orders board, in the Routing driver picker,');
  console.log('and new orders are assigned to whichever base is nearest.');
  console.log('Nobody can sign in as them - the numbers are fictional.');

  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
