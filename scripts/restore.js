'use strict';

// ---------------------------------------------------------------------------
// Put a backup back.
//
//   npm run restore -- <file>            say what it WOULD do, change nothing
//   npm run restore -- <file> --write    actually do it
//
// A DRY RUN BY DEFAULT, like every other script here that can destroy
// something. This is the one you reach for on the worst day of the year, and
// on that day you want to see the plan before it runs.
//
// WHAT IT DOES: empties every table in the backup and writes the rows back.
// That is a REPLACE, not a merge - anything created since the backup was taken
// is gone. There is no clever three-way merge and there should not be: on the
// day you need this, "put it back exactly as it was" is the only instruction
// anybody can reason about under pressure.
//
// It refuses to restore a backup taken from a DIFFERENT database unless told
// twice, because restoring production out of a UAT dump is the exact accident
// this whole file exists to survive.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const FORCE = args.includes('--force-different-database');
const file = args.find((a) => !a.startsWith('--'));

// Inserted in pages: one statement with ten thousand rows in it is how a
// restore fails halfway and leaves you worse off than when you started.
const PAGE = 500;

(async () => {
  if (!file) {
    console.error('Which backup? npm run restore -- backups/lyndry-....json');
    process.exit(1);
  }

  const full = path.resolve(file);
  if (!fs.existsSync(full)) {
    console.error(`No such file: ${full}`);
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(full, 'utf8'));
  const here = String(process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '');

  console.log(`Backup taken : ${backup.takenAt}`);
  console.log(`  from       : ${backup.source || '(not recorded)'}`);
  console.log(`  restoring to: ${here}\n`);

  if (backup.source && here && backup.source !== here && !FORCE) {
    console.error('That backup came from a DIFFERENT database than the one you are pointed at.');
    console.error('If you really mean it, add --force-different-database.');
    process.exit(1);
  }

  // Children first on the way out, parents first on the way in. `order` is
  // recorded in the backup itself so a restore does not depend on this file
  // agreeing with the one that wrote it.
  const order = backup.order || Object.keys(backup.tables);
  const present = order.filter((t) => Array.isArray(backup.tables[t]));

  console.log(WRITE ? 'RESTORING:\n' : 'Would restore (dry run):\n');

  for (const table of present) {
    const rows = backup.tables[table];
    const { count } = await db.from(table).select('id', { count: 'exact', head: true });
    console.log(`  ${table.padEnd(22)}${String(count || 0).padStart(6)} now  ->${String(rows.length).padStart(6)} from the backup`);
  }

  if (!WRITE) {
    console.log('\nNothing was changed. Add --write to do it.');
    process.exit(0);
  }

  console.log('');

  // Emptied in reverse order, so a child table is cleared before the parent it
  // points at.
  for (const table of [...present].reverse()) {
    const { error } = await db.from(table).delete().not('id', 'is', null);
    if (error) throw new Error(`clearing ${table}: ${error.message}`);
  }

  for (const table of present) {
    const rows = backup.tables[table];
    for (let i = 0; i < rows.length; i += PAGE) {
      const chunk = rows.slice(i, i + PAGE);
      const { error } = await db.from(table).insert(chunk);
      if (error) throw new Error(`restoring ${table}: ${error.message}`);
    }
    console.log(`  ${table.padEnd(22)}${String(rows.length).padStart(6)} restored`);
  }

  console.log('\nDone.');
  process.exit(0);
})().catch((err) => {
  console.error('\nRestore FAILED:', err.message);
  console.error('The database may be half restored. Run it again with the same file.');
  process.exit(1);
});
