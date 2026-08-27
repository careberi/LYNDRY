'use strict';

// ---------------------------------------------------------------------------
// A backup of everything in the database, as one file.
//
//   npm run backup              write a new backup into backups/
//   npm run backup -- --list    what backups exist
//
// WHY THIS EXISTS RATHER THAN SUPABASE'S OWN BACKUPS: the project is on the
// free plan, which has no automated backups and no point-in-time recovery. So
// until that changes there is nothing standing between a bad DELETE and losing
// the business, and this is the cheapest thing that is genuinely better than
// nothing.
//
// IT IS NOT A REPLACEMENT FOR PROPER BACKUPS. It runs when somebody remembers
// to run it, it is a row-by-row read rather than a consistent snapshot, and a
// long backup can catch a write halfway. Supabase Pro gives daily backups taken
// properly; this is the stopgap.
//
// The file is plain JSON: one key per table, an array of rows. Boring on
// purpose - it can be opened, read and fixed by hand, which is exactly what you
// want from the thing you reach for on a bad day.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const DIR = path.join(__dirname, '..', 'backups');

// Order matters on the way back IN, so it is recorded here on the way OUT:
// parents before children, so a restore never writes a row whose foreign key
// has nothing to point at yet.
const TABLES = [
  'app_settings',
  'promotions',
  'ops_users',
  'ops_user_hours',
  'vehicles',
  'partners',
  'partner_hours',
  'partner_enquiries',
  'buildings',
  'lockers',
  'customers',
  'customer_promotions',
  'recurring_schedules',
  'orders',
  'order_events',
  'bag_labels',
  'bag_label_scans',
  'issues',
  'messages',
  'payment_links',
  'broadcasts',
];

// Rows are pulled in pages: a plain select stops at Supabase's row cap, and a
// backup that silently stops at 1,000 rows is worse than no backup because it
// looks like it worked.
const PAGE = 1000;

async function dumpTable(table) {
  const rows = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select('*')
      .range(from, from + PAGE - 1);

    if (error) {
      // A table that does not exist yet is not a failure - migrations run
      // ahead of this list sometimes, and the other way round.
      if (/does not exist|schema cache/i.test(error.message)) return null;
      throw new Error(`${table}: ${error.message}`);
    }

    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }

  return rows;
}

(async () => {
  if (process.argv.includes('--list')) {
    if (!fs.existsSync(DIR)) return console.log('No backups yet.');
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().reverse();
    if (!files.length) return console.log('No backups yet.');

    console.log(`${files.length} backup${files.length === 1 ? '' : 's'}:\n`);
    for (const f of files) {
      const { size } = fs.statSync(path.join(DIR, f));
      const body = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const rows = Object.values(body.tables).reduce((t, r) => t + r.length, 0);
      console.log(`  ${f.padEnd(34)}${String(rows).padStart(6)} rows   ${(size / 1024).toFixed(0)} KB`);
    }
    return;
  }

  fs.mkdirSync(DIR, { recursive: true });

  const startedAt = new Date();
  const tables = {};
  let total = 0;

  console.log('Backing up:\n');

  for (const table of TABLES) {
    const rows = await dumpTable(table);
    if (rows === null) {
      console.log(`  ${table.padEnd(22)} (no such table, skipped)`);
      continue;
    }
    tables[table] = rows;
    total += rows.length;
    console.log(`  ${table.padEnd(22)}${String(rows.length).padStart(6)}`);
  }

  // The filename sorts chronologically as text, which is what makes "the most
  // recent one" a sort rather than a date parse.
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(DIR, `lyndry-${stamp}.json`);

  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        takenAt: startedAt.toISOString(),
        // Which database this came from, so nobody restores production out of
        // a UAT backup by accident. Host only - no key, ever.
        source: String(process.env.SUPABASE_URL || '').replace(/^https?:\/\//, ''),
        order: TABLES,
        tables,
      },
      null,
      2
    )
  );

  console.log(`\n  ${total} rows -> ${path.relative(process.cwd(), file)}`);
  console.log('\n  Restore with: npm run restore -- <file> --write');
  process.exit(0);
})().catch((err) => {
  console.error('\nBackup FAILED:', err.message);
  console.error('Nothing was written. Do not assume you have a backup.');
  process.exit(1);
});
