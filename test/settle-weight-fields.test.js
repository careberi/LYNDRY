'use strict';

// ---------------------------------------------------------------------------
// WHOEVER HANDS AN ORDER TO settleWeight() HAS TO HAVE LOADED WHAT IT READS.
//
// THE BUG THIS EXISTS FOR WAS LIVE. The laundromat portal's `ORDER_FIELDS` did
// not select `weight_settled_at`. That column is the FIRST thing settleWeight()
// looks at:
//
//   if (order.weight_settled_at) { ...record the partner's scale...; return }
//
// It is what stops an order being priced twice - a van order is charged at the
// doorstep, so by the time a laundromat weighs it there is nothing left to do.
// Unselected, the column arrives `undefined`, which is falsy, so that early
// return never fired from the portal: a PAID order weighed at a counter fell
// through to the two-scale branch, and a disagreement wrote `weight_held_at` on
// it and raised an issue reading "NOTHING HAS BEEN CHARGED and the customer has
// not been told a price". Both false, about an order settled days earlier.
//
// SIXTH TIME. CLAUDE.md counts this against CARD_FIELDS, BOARD_FIELDS,
// RUN_FIELDS, the order page's own list, and the carrier columns. The shape is
// always the same: an unselected column is undefined, and undefined is
// indistinguishable from the value that means "nothing to do here".
//
// SO THE CHECK IS DERIVED, NOT A LIST. It reads which columns settleWeight()
// actually touches and holds every feeding select against them, so a branch
// added there tomorrow is covered without anybody remembering this file.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (...bits) => fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8');

// Every `order.<column>` inside settleWeight's body.
function columnsSettleWeightReads() {
  const src = SRC('core', 'fulfilment.js');

  const at = src.indexOf('async function settleWeight(');
  if (at === -1) return null;

  // To the next top-level function, which is where its body ends.
  const next = src.indexOf('\nasync function ', at + 10);
  const body = src.slice(at, next === -1 ? src.length : next);

  return [...new Set([...body.matchAll(/\border\.([a-z_]+)/g)].map((m) => m[1]))]
    .filter((c) => c !== 'customers') // a join, not a column
    .sort();
}

test('settleWeight is findable and reads a plausible set of columns', () => {
  const columns = columnsSettleWeightReads();

  assert.ok(columns, 'settleWeight() has been renamed or moved');
  assert.ok(columns.length >= 5, `only found ${columns.length} columns, which looks like a parse failure`);
  assert.ok(columns.includes('weight_settled_at'), 'the early-return column is not being found');
  assert.ok(columns.includes('partner_weight_lb'), 'the laundromat scale column is not being found');
});

test('THE LAUNDROMAT PORTAL SELECTS EVERY ONE OF THEM', () => {
  const columns = columnsSettleWeightReads();
  const src = SRC('routes', 'shop.js');

  const fields = /const ORDER_FIELDS =[\s\S]*?';$/m.exec(src);
  assert.ok(fields, 'shop.js ORDER_FIELDS has been renamed or removed');

  const missing = columns.filter((c) => !fields[0].includes(c));

  assert.deepEqual(
    missing,
    [],
    'the portal hands an order to settleWeight() without these columns, so they arrive undefined - ' +
      'and undefined is indistinguishable from the value that means "nothing to do here"'
  );
});

test('and the bag tag page does too, by selecting everything', () => {
  // `tags.findByTag()` selects `'*, customers(...)'`, which is why the tag page
  // never had this bug. Pinned so that trimming it to a list later cannot
  // quietly reintroduce it without this test noticing.
  const src = SRC('core', 'tags.js');
  const fn = /async function findByTag\([\s\S]*?\n}/.exec(src);

  assert.ok(fn, 'tags.findByTag() has been renamed or removed');
  assert.match(
    fn[0],
    /\.select\(\s*['"`]\*/,
    'findByTag no longer selects * - it now needs every column settleWeight reads, listed explicitly'
  );
});
