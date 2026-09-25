'use strict';

// ---------------------------------------------------------------------------
// APPLY THE MIGRATION FILES TO WHICHEVER DATABASE THIS .env POINTS AT.
//
//   npm run migrate              list what would be applied, write nothing
//   npm run migrate -- --write   apply it
//
// WHY THIS EXISTS. Until 25 September there was no runner at all: the 99 files
// in supabase/migrations were the record of the schema, and they were applied
// by pasting SQL into the Supabase dashboard by hand. That was survivable with
// one database. With two it is not - the moment a migration is applied to one
// and not the other, a feature works in development and fails in production for
// reasons nothing anywhere can explain, and there was no way even to ASK which
// files a database had seen.
//
// WHAT IT RECORDS. A `schema_migrations` row per file, with a checksum of the
// file as it was applied. The checksum is the interesting half: it catches a
// migration EDITED after the fact, which is the one way two databases can have
// applied "the same" 99 files and still differ. A changed file is reported and
// never silently re-run.
//
// ONE FILE, ONE TRANSACTION. Postgres runs a multi-statement query as a single
// implicit transaction, so a file that fails half way leaves nothing behind and
// the run stops there rather than carrying on into files that assumed it
// worked. Verified that no migration uses CREATE INDEX CONCURRENTLY or anything
// else that cannot run inside a transaction.
//
// IT REFUSES TO MIGRATE A DATABASE THIS .env IS NOT POINTED AT. The connection
// string carries its own host, so it is perfectly possible to hold dev's
// SUPABASE_URL and production's password. That mistake would apply migrations
// to the live database while every other line on screen said development, so
// the two are checked against each other before anything runs.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const { config, describeTarget } = require('../src/config');

const WRITE = process.argv.includes('--write');
const DIR = path.join(__dirname, '..', 'supabase', 'migrations');

const checksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);

function migrationFiles() {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      // Read as bytes and decode once, so the em dashes and curly quotes in the
      // comments survive. CLAUDE.md records that a PowerShell round trip does
      // not, and 68 of these files contain them.
      const sql = fs.readFileSync(path.join(DIR, name), 'utf8');
      return { name, sql, checksum: checksum(sql) };
    });
}

// The project a connection string belongs to. Supabase hosts are either
// db.<ref>.supabase.co or <something>.pooler.supabase.com with the ref in the
// username, so both shapes are read.
function refOfConnectionString(url) {
  const text = String(url || '');
  const direct = /@db\.([a-z0-9]+)\.supabase\./i.exec(text);
  if (direct) return direct[1].toLowerCase();

  const pooled = /\/\/postgres\.([a-z0-9]+):/i.exec(text);
  return pooled ? pooled[1].toLowerCase() : '';
}

async function main() {
  console.log(`Migrating: ${describeTarget()}\n`);

  const url = process.env.SUPABASE_DB_URL || '';
  if (!url) {
    console.error('SUPABASE_DB_URL is not set.');
    console.error('Supabase dashboard -> Connect -> Session pooler, and paste the URI into .env.');
    process.exit(1);
  }

  // THE TWO HALVES OF "WHICH DATABASE" MUST AGREE.
  const connectionRef = refOfConnectionString(url);
  if (connectionRef && config.supabase.projectRef && connectionRef !== config.supabase.projectRef) {
    console.error('REFUSED: this .env and this connection string point at different projects.');
    console.error(`  SUPABASE_URL     -> ${config.supabase.projectRef}`);
    console.error(`  SUPABASE_DB_URL  -> ${connectionRef}`);
    console.error('\nFix whichever one is wrong before running this again.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    // Supabase terminates TLS with a certificate chain Node does not ship a
    // root for. The connection is still encrypted; what is skipped is proving
    // the server's identity, which is the same trade the Supabase CLI makes.
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        name        text primary key,
        checksum    text not null,
        applied_at  timestamptz not null default now()
      );
    `);

    const { rows } = await client.query('select name, checksum from schema_migrations');
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    const files = migrationFiles();
    const pending = files.filter((f) => !applied.has(f.name));
    const changed = files.filter((f) => applied.has(f.name) && applied.get(f.name) !== f.checksum);

    // A FILE EDITED AFTER IT WAS APPLIED IS THE SILENT DRIFT THIS CATCHES.
    // Reported every run, never re-applied: re-running it might work, might
    // fail, or might do something different from what the other database got,
    // and guessing which is not this script's business.
    if (changed.length) {
      console.log('CHANGED SINCE THEY WERE APPLIED, which means the two databases may differ:');
      for (const f of changed) console.log(`  ${f.name}`);
      console.log('');
    }

    console.log(`${files.length} migration files, ${applied.size} already applied.`);

    if (!pending.length) {
      console.log('Nothing to apply.');
      return;
    }

    console.log(`${pending.length} to apply:`);
    for (const f of pending) console.log(`  ${f.name}`);

    if (!WRITE) {
      console.log('\nDRY RUN. Nothing was applied. Run again with --write to do it.');
      return;
    }

    console.log('');
    for (const f of pending) {
      process.stdout.write(`  ${f.name} ... `);
      try {
        await client.query(f.sql);
        await client.query(
          'insert into schema_migrations (name, checksum) values ($1, $2) on conflict (name) do nothing',
          [f.name, f.checksum]
        );
        console.log('ok');
      } catch (err) {
        console.log('FAILED');
        console.error(`\n${f.name} failed and nothing after it was applied:\n  ${err.message}\n`);
        process.exitCode = 1;
        return;
      }
    }

    console.log(`\nDone. ${pending.length} applied.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nMigration run failed:', err.message);
  process.exit(1);
});
