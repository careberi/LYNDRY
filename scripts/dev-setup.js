'use strict';

// ---------------------------------------------------------------------------
// MAKE A FRESHLY MIGRATED DEVELOPMENT DATABASE USABLE.
//
//   npm run dev:setup              say what it would do
//   npm run dev:setup -- --write   do it
//
// Three things, none of which any migration can do, and each of which is
// discovered the hard way if nothing does it here.
//
// ONE. AN ADMIN WHO IS ACTUALLY AN ADMIN. `npm run ops:user -- add` inserts a
// person with no role, and the column defaults to DRIVER. Migration 0009
// promotes existing staff to ADMIN, which on an empty database promotes
// nobody. So the first and only person to sign in to a new environment gets a
// driver's view - no customers, no money, no team page, no promotions - and
// CLAUDE.md is explicit that nobody may change their own role, so there is no
// way out from inside the browser. It looks like the build is broken.
//
// TWO. ORDER NUMBERS THAT CANNOT BE MISTAKEN FOR REAL ONES. Production is in
// the 2000s. A fresh database starts at 1001 and would walk straight into the
// same range, so "#2085" would name two different orders and a conversation
// about a real customer could act on a test row. Development starts at 9000.
//
// THREE. THE AUTOMATIC PROMOTION. CLEAN50 lives in production DATA, not in a
// migration - it was made through the ops screens. Without it the website
// popup is absent from every page and no new number is offered anything, so
// the first-message wording cannot be reproduced at all.
//
// IT REFUSES TO RUN AGAINST PRODUCTION, on its own, rather than trusting the
// guard in db.js - this one talks to Postgres directly and never goes through
// that file.
// ---------------------------------------------------------------------------

const { Client } = require('pg');
const { config, describeTarget } = require('../src/config');

const WRITE = process.argv.includes('--write');

const ADMIN = { name: 'Neil Perry', phone: '+14437452665' };
const FIRST_ORDER_NUMBER = 9000;

// Split by hand rather than through a URL parser. See the long note in
// scripts/migrate.js: a generated password full of punctuation is not a URL.
function connectionFields(url) {
  const value = String(url || '').trim().replace(/^["']|["']$/g, '');
  const scheme = value.indexOf('://');
  const at = value.lastIndexOf('@');
  if (scheme === -1 || at === -1) return null;

  const credentials = value.slice(scheme + 3, at);
  const colon = credentials.indexOf(':');
  if (colon === -1) return null;

  const rest = value.slice(at + 1);
  const slash = rest.indexOf('/');
  const hostPort = slash === -1 ? rest : rest.slice(0, slash);
  const [host, port] = hostPort.split(':');

  return {
    user: credentials.slice(0, colon),
    password: credentials.slice(colon + 1),
    host,
    port: Number(port) || 5432,
    database: (slash === -1 ? 'postgres' : rest.slice(slash + 1).split('?')[0]) || 'postgres',
  };
}

async function main() {
  console.log(`Dev setup: ${describeTarget()}\n`);

  if (config.supabase.isProduction) {
    console.error('REFUSED: this is the production database.');
    console.error('This script invents an admin and moves the order number sequence.');
    process.exit(1);
  }

  const fields = connectionFields(process.env.SUPABASE_DB_URL);
  if (!fields) {
    console.error('SUPABASE_DB_URL is not set, or is not a connection string.');
    process.exit(1);
  }

  const client = new Client({ ...fields, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const { rows: staff } = await client.query('select name, phone, role, status from ops_users');
    const { rows: seq } = await client.query("select last_value from order_number_seq");
    const { rows: promos } = await client.query('select name, status, audience from promotions');

    console.log('now:');
    console.log(`  staff            : ${staff.length ? staff.map((s) => `${s.name} (${s.role})`).join(', ') : 'nobody'}`);
    console.log(`  next order number: ${Number(seq[0].last_value) + 1}`);
    console.log(`  promotions       : ${promos.length ? promos.map((p) => p.name).join(', ') : 'none'}`);

    if (!WRITE) {
      console.log('\nDRY RUN. It would:');
      console.log(`  - add ${ADMIN.name} ${ADMIN.phone} as an ACTIVE ADMIN who drives`);
      console.log(`  - move the order number sequence to ${FIRST_ORDER_NUMBER}`);
      console.log('  - create a CLEAN50 automatic promotion, 50% off the first order');
      console.log('\nRun again with --write to do it.');
      return;
    }

    // ONE. The admin.
    await client.query(
      `insert into ops_users (name, phone, role, status, drives)
       values ($1, $2, 'ADMIN', 'ACTIVE', true)
       on conflict (phone) do update set role = 'ADMIN', status = 'ACTIVE', drives = true`,
      [ADMIN.name, ADMIN.phone]
    );
    console.log(`\nadmin      : ${ADMIN.name} ${ADMIN.phone}, ADMIN, driving`);

    // TWO. The order numbers. setval with `false` means the NEXT value handed
    // out is this one, rather than one past it.
    await client.query('select setval($1, $2, false)', ['order_number_seq', FIRST_ORDER_NUMBER]);
    console.log(`orders     : numbering starts at #${FIRST_ORDER_NUMBER}`);

    // THREE. The offer every new number is given, which is what puts the popup
    // on the website. Matched to production's row rather than invented: the
    // audience is what makes it automatic, and the blurb is what the AI is
    // allowed to repeat.
    await client.query(
      `insert into promotions (name, blurb, kind, value, applies_to, audience, status, code, expires_days, auto_grant)
       values ('CLEAN50 - 50% off first order', '50% off your first order', 'PERCENT_OFF', 50,
               'FIRST_ORDER', 'NEW_NUMBERS', 'ACTIVE', 'CLEAN50', 30, true)
       on conflict do nothing`
    );
    await client.query('update app_settings set website_popup = true');
    console.log('promotion  : CLEAN50 active, automatic, popup on');

    console.log('\nSigning in: run `npm run dev`, open http://localhost:3000/ops/login,');
    console.log(`enter ${ADMIN.phone}, and read the six-digit code out of the terminal -`);
    console.log('the fake SMS driver prints texts there instead of sending them.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nDev setup failed:', err.message);
  process.exit(1);
});
