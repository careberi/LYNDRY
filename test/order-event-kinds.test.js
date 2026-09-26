'use strict';

// ---------------------------------------------------------------------------
// EVERY EVENT KIND THE CODE WRITES IS ONE THE DATABASE ACCEPTS.
//
// `order_events.kind` has a CHECK constraint, and `orderEvents.record()` swallows
// its own errors and logs loudly - CLAUDE.md's rule that recording must never
// break the thing being recorded, because a driver at a door must not be stopped
// by the audit trail failing.
//
// THE COST OF THAT RULE IS THAT A KIND THE CONSTRAINT REFUSES IS INVISIBLE from
// the caller's side. It happened: a courier was booked against a real order, the
// `courier_deliveries` row was written, the attendant was told a courier was
// coming - and the order's change log said nothing at all, because `COURIER` was
// not on the list. Nothing errored anywhere.
//
// SO THE TWO LISTS ARE HELD TOGETHER HERE, by reading the migration rather than
// the database, so it needs no connection and runs in the ordinary suite.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');
const SRC = path.join(__dirname, '..', 'src');

// The kinds the CHECK constraint allows, from whichever migration last set it.
function allowedKinds() {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let allowed = null;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    // The last `add constraint order_events_kind_check ... check (kind in (...))`
    // wins, the same way Postgres sees it.
    const found = [...sql.matchAll(/order_events_kind_check[\s\S]*?check\s*\(\s*kind\s+in\s*\(([\s\S]*?)\)\s*\)/g)];
    if (found.length) {
      allowed = new Set(
        [...found[found.length - 1][1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
      );
    }
  }

  return allowed;
}

// Every `kind: 'X'` written anywhere under src/.
function kindsWritten() {
  const found = new Map();

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const here = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(here);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;

      const src = fs.readFileSync(here, 'utf8');

      // `kind: 'STATUS'` inside an orderEvents.record() call. Matched loosely and
      // filtered below, because several other tables have a `kind` column.
      for (const m of src.matchAll(/kind:\s*'([A-Z_]+)'/g)) {
        const where = path.relative(SRC, here).split('\\').join('/');
        if (!found.has(m[1])) found.set(m[1], where);
      }
    }
  };

  walk(SRC);
  return found;
}

// `messages.kind` shares the property name and is a different column with a
// different list. Named here rather than guessed at, so a new one has to be
// thought about.
const NOT_ORDER_EVENTS = new Set(['AI', 'FOLLOW_UP', 'PERSON', 'SYSTEM']);

test('THE CHECK CONSTRAINT IS FINDABLE AT ALL', () => {
  const allowed = allowedKinds();

  assert.ok(allowed, 'no order_events_kind_check constraint found in any migration');
  assert.ok(allowed.size > 5, `only ${allowed.size} kinds parsed, which looks like a parsing failure`);
  assert.ok(allowed.has('STATUS'), 'STATUS is missing, so the parse is wrong');
});

test('EVERY KIND THE CODE WRITES IS ONE THE DATABASE WILL TAKE', () => {
  const allowed = allowedKinds();
  const written = kindsWritten();

  const rejected = [...written.entries()]
    .filter(([kind]) => !NOT_ORDER_EVENTS.has(kind))
    .filter(([kind]) => !allowed.has(kind))
    .map(([kind, where]) => `${kind} (written in ${where})`);

  assert.deepEqual(
    rejected,
    [],
    'these order event kinds are refused by the CHECK constraint, and orderEvents.record() ' +
      'swallows the failure - so the change log silently loses them. Add them in a migration.'
  );
});

test('and COURIER is on the list, because booking one is a change to the order', () => {
  // The one that was actually lost. A courier taking a finished order back to
  // the customer belongs in its change log with a name against it, exactly like
  // a weight or a status move.
  assert.ok(allowedKinds().has('COURIER'));
});
