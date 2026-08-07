'use strict';

// ---------------------------------------------------------------------------
// Seed script — puts test data into the database.
//
// Run it with:   npm run seed
//
// It is safe to run as many times as you like. It looks for existing rows
// first and updates them rather than creating duplicates.
//
// What it creates:
//   - one test apartment building (unused at launch, here for locker testing)
//   - five lockers in that building
//   - Neil as a residential customer, so there is someone to text as
// ---------------------------------------------------------------------------

const db = require('../src/db');

// --- The data ---------------------------------------------------------------

const BUILDING = {
  name: 'LYNDRY Test Building',
  address: '100 Test Street, Jersey City, NJ 07302',
};

const LOCKER_LABELS = ['A1', 'A2', 'A3', 'A4', 'A5'];

const CUSTOMER = {
  // Phone numbers are always stored in +1XXXXXXXXXX form. This is the identity
  // of a customer — it is how an inbound text is matched to a person.
  phone: '+12017010942',
  name: 'Neil Perry',
  email: 'neil@lyndry.com',

  // Residential customer: street address, no building.
  // TODO: replace with Neil's real address.
  address_line1: '1 Placeholder Ave',
  address_line2: null,
  city: 'Jersey City',
  state: 'NJ',
  postal_code: '07302',

  // Collected once on the website so SMS never has to ask about any of it.
  preferences: {
    water_temp: 'COLD',
    detergent: 'STANDARD',
    fabric_softener: true,
    special_instructions: '',
    default_pickup_method: 'LEAVE_OUTSIDE',
  },

  // Seed data only. Real consent is captured by the signup form in phase 5,
  // with the customer's real IP address.
  sms_consent_at: new Date().toISOString(),
  sms_consent_ip: '127.0.0.1',
  status: 'ACTIVE',
};

// --- Helpers ----------------------------------------------------------------

// Supabase returns errors instead of throwing them. This turns an error into a
// thrown exception so the script stops loudly instead of continuing silently.
function unwrap(label, { data, error }) {
  if (error) {
    throw new Error(`${label} failed: ${error.message}`);
  }
  return data;
}

// --- The work ---------------------------------------------------------------

async function seedBuilding() {
  const existing = unwrap(
    'looking up building',
    await db.from('buildings').select('id, name').eq('name', BUILDING.name).maybeSingle()
  );

  if (existing) {
    console.log(`building   : reusing "${existing.name}"`);
    return existing.id;
  }

  const created = unwrap(
    'creating building',
    await db.from('buildings').insert(BUILDING).select('id, name').single()
  );

  console.log(`building   : created "${created.name}"`);
  return created.id;
}

async function seedLockers(buildingId) {
  const rows = LOCKER_LABELS.map((label, index) => ({
    building_id: buildingId,
    label,
    // Placeholders until real hardware exists in phase 7. The fake lock driver
    // ignores these; the Shelly driver will use them to find the right relay.
    controller_id: 'FAKE-CONTROLLER-1',
    relay_channel: index,
    state: 'AVAILABLE',
  }));

  // onConflict matches the unique (building_id, label) constraint, so running
  // this again updates the same five lockers instead of adding five more.
  const lockers = unwrap(
    'creating lockers',
    await db
      .from('lockers')
      .upsert(rows, { onConflict: 'building_id,label' })
      .select('label, state')
  );

  console.log(`lockers    : ${lockers.length} ready (${lockers.map((l) => l.label).join(', ')})`);
}

async function seedCustomer() {
  const customer = unwrap(
    'creating customer',
    await db
      .from('customers')
      .upsert(CUSTOMER, { onConflict: 'phone' })
      .select('id, name, phone, city, state')
      .single()
  );

  console.log(`customer   : ${customer.name} ${customer.phone} (${customer.city}, ${customer.state})`);
  return customer.id;
}

async function main() {
  console.log('Seeding LYNDRY database...\n');

  const buildingId = await seedBuilding();
  await seedLockers(buildingId);
  await seedCustomer();

  // A quick count of everything, so you can compare against the Supabase
  // dashboard and be sure you are looking at the right project.
  console.log('\nRow counts:');
  for (const table of ['buildings', 'customers', 'lockers', 'orders', 'messages']) {
    const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
    console.log(`  ${table.padEnd(10)} ${error ? `error: ${error.message}` : count}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
