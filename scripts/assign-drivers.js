'use strict';

// ---------------------------------------------------------------------------
// Give every unassigned order a driver.
//
//   npm run assign            what it would do, and nothing else
//   npm run assign -- --write actually save it
//
// New orders are assigned as they are booked. This is for the ones that existed
// before drivers had home bases, and for the day somebody's base is filled in
// and yesterday's orders should follow it.
//
// SAFE TO RUN ANY NUMBER OF TIMES. It only ever touches orders with no driver,
// so an order somebody reassigned by hand is never quietly moved back - the
// automatic answer knows about distance and nothing about why a human chose
// differently.
// ---------------------------------------------------------------------------

const db = require('../src/db');
const drivers = require('../src/core/drivers');
const geocode = require('../src/core/geocode');

const WRITE = process.argv.includes('--write');

(async () => {
  const team = await drivers.active();

  if (!team.length) {
    console.log('Nobody on the team can drive, so there is nobody to assign to.');
    console.log('Add somebody as a Driver at /ops/team first.');
    process.exit(0);
  }

  console.log(`${team.length} driver${team.length === 1 ? '' : 's'}:`);
  for (const person of team) {
    const base = drivers.baseOf(person);
    console.log(
      `  ${person.name.padEnd(18)}${
        base.own ? `${person.base_city || person.base_address_line1}` : 'no base - falls back to the service base'
      }`
    );
  }
  console.log('');

  // Anything still open and ownerless. Delivered and cancelled orders are left
  // alone: assigning a driver to work that is finished would put rows in
  // somebody's history they never touched.
  const { data: orders, error } = await db
    .from('orders')
    .select('id, order_number, status, driver_id, customers(*)')
    .is('driver_id', null)
    .not('status', 'in', '(DELIVERED,CANCELED)')
    .order('order_number', { ascending: true });

  if (error) throw error;

  if (!orders || !orders.length) {
    console.log('Every open order already has a driver.');
    process.exit(0);
  }

  console.log(`${orders.length} order${orders.length === 1 ? '' : 's'} with no driver:\n`);

  let assigned = 0;
  let stuck = 0;

  for (const order of orders) {
    const at = await geocode.locate(order.customers || {});

    if (!at) {
      console.log(`  #${order.order_number}  no map pin for the address - left unassigned`);
      stuck += 1;
      continue;
    }

    const best = await drivers.nearest(at, { drivers: team });

    if (!best) {
      console.log(`  #${order.order_number}  nobody to assign to - left unassigned`);
      stuck += 1;
      continue;
    }

    console.log(
      `  #${order.order_number}  ${best.driver.name.padEnd(18)}${best.miles.toFixed(1)} mi from their base` +
        (best.ownBase ? '' : '  (service base)')
    );

    if (WRITE) {
      const { error: saveError } = await db
        .from('orders')
        .update({ driver_id: best.driver.id })
        .eq('id', order.id);
      if (saveError) throw saveError;
    }

    assigned += 1;
  }

  console.log('');
  if (WRITE) {
    console.log(`Saved. ${assigned} assigned, ${stuck} left unassigned.`);
  } else {
    console.log(`Nothing was saved. ${assigned} would be assigned, ${stuck} would stay unassigned.`);
    console.log('Run it again with --write to save.');
  }

  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
