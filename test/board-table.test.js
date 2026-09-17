'use strict';

// ---------------------------------------------------------------------------
// THE BOARD IS FLAT: ONE FIELD PER COLUMN, AND TWO LINKS THAT GO TWO PLACES.
//
// Neil's decision lock, 14 September:
//
//   the order number  opens that order
//   the customer name opens that customer
//   one field         per column, with detail on the detail pages
//
// Both links used to point at the order, so there was no way to reach a
// profile from the board at all - and the name read as a link to somebody's
// history while behaving like a link to one row of it.
//
// Three things were wedged under a first field in smaller grey type: the
// address under the customer, the arrival window under the pickup date, and
// "expected" under a promotion that had not come off anything. A table you read
// by scanning down a column cannot carry a second fact in the same cell.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const SRC = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8')
  .split('\r\n')
  .join('\n');

// The board's own row builder, which every section on /ops draws through - To
// collect, Being washed, Upcoming, Past and the look back at a past day all
// call the same one, so they cannot differ.
function boardRow() {
  const at = SRC.indexOf('    const row = (o) => {');
  assert.notEqual(at, -1, 'the board row builder has moved');
  return SRC.slice(at, SRC.indexOf('\n    };\n', at));
}

function boardHeadings() {
  const at = SRC.indexOf('    const headings = [');
  assert.notEqual(at, -1, 'the board headings have moved');
  return SRC.slice(at, SRC.indexOf('\n\n', at));
}

// --- the two links ----------------------------------------------------------

test('THE ORDER NUMBER OPENS THE ORDER', () => {
  assert.match(boardRow(), /href="\/ops\/orders\/\$\{o\.order_number\}"/);
});

test('AND THE CUSTOMER NAME OPENS THE CUSTOMER', () => {
  const row = boardRow();
  assert.match(row, /href="\/ops\/customers\/\$\{escapeHtml\(c\.id\)\}"/);

  // The failure this replaces: the name pointed at the order, so a board with
  // ten rows for one customer had ten links and none of them reached them.
  const customerCell = row.slice(row.indexOf('const customerCell'), row.indexOf('return ['));
  assert.ok(!/\/ops\/orders\//.test(customerCell), 'the customer name still opens an order');
});

test('A MISSING CUSTOMER IS A FALLBACK, NEVER A BROKEN LINK', () => {
  // An order can legitimately have no customer row, and
  // /ops/customers/undefined is a 404 somebody reports as a bug.
  const row = boardRow();
  assert.match(row, /c\.id\s*\?/, 'the customer link is built without checking there is one');
  assert.match(row, /Unknown/);
});

test('and a driver gets no customer link at all', () => {
  // Not "a link that 403s". CLAUDE.md's rule: a role that cannot open a
  // customer profile is never shown one. Their column is the address, which is
  // the only thing on the board telling them which door to drive to - taking
  // the address out of the CUSTOMER column is not the same as taking it off a
  // driver's board.
  const row = boardRow();
  assert.match(row, /showNames\s*\n?\s*\?\s*customerCell/);
  assert.match(row, /addressOf\(c\)/);
});

// --- one field per column ---------------------------------------------------

test('PICKUP IS TWO COLUMNS', () => {
  const headings = boardHeadings();
  assert.match(headings, /'Pickup date'/);
  assert.match(headings, /'Pickup time'/);
  assert.ok(!/'Pickup'/.test(headings), 'the combined Pickup column came back');
});

test('and a pickup with no time says so rather than leaving a blank', () => {
  const row = boardRow();
  assert.match(row, /pickup_window_start \? escapeHtml\(booking\.arrivalWindow\(o\)\) : '—'/);
});

test('THE ADDRESS IS OUT OF THE CUSTOMER COLUMN', () => {
  const row = boardRow();
  const customerCell = row.slice(row.indexOf('const customerCell'), row.indexOf('return ['));
  assert.ok(!/addressOf/.test(customerCell), 'the address is still under the customer name');
});

test('AND NOTHING IS STACKED UNDER ANYTHING ELSE', () => {
  // Every one of the three faults was the same shape: a <div> of smaller grey
  // type inside a cell. If one comes back, it comes back like this.
  const row = boardRow();
  assert.ok(
    !/font-size:13px;color:var\(--ink-500\)/.test(row),
    'a second line of grey detail is back inside a cell'
  );
});

// --- the promotion column ---------------------------------------------------

test('THE PROMOTION COLUMN SHOWS WHAT WAS APPLIED, AND NOTHING ELSE', () => {
  const at = SRC.indexOf('function promoCell(');
  assert.notEqual(at, -1);
  const body = SRC.slice(at, SRC.indexOf('\n}\n', at));

  assert.match(body, /order\.promotions/);
  assert.match(body, /return '—'/, 'no promotion does not show as a dash');

  // An offer somebody merely qualifies for has not come off anything yet, and
  // saying so under a heading that reads Promotion says it has.
  assert.ok(!/expected/.test(body.replace(/\/\/.*$/gm, '')), 'the expected branch came back');
  assert.ok(!/discount_cents/.test(body), 'the discount is back under the promotion name');
});

test('and the BOARD no longer asks the promotion ledger what is coming', () => {
  // The column cannot quietly start showing a forecast again.
  //
  // SCOPED TO THE BOARD ROUTE NOW, NOT THE WHOLE FILE. This read admin.js end
  // to end and refused expectedForMany() anywhere in it - right while nothing
  // called it, and wrong the moment the question was answered where Neil's own
  // lock said it belonged: the order page, where there is room to say
  // 'expected' and have it read as a forecast rather than as a fact. The order
  // page calls it now. The board still must not.
  const at = SRC.indexOf("router.get('/ops', ");
  assert.ok(at > 0, 'the board route has moved');

  const board = withoutComments(SRC.slice(at, SRC.indexOf('\nrouter.', at + 10)));

  assert.ok(!/expectedForMany/.test(board), 'the board still works out expected promotions');
  assert.ok(!/promoCell\(o, /.test(board), 'promoCell is still passed an expected promotion');
});

test('and the board cell shows only what was APPLIED', () => {
  // The row builder is shared by every section, so this is the guarantee that
  // matters however the route above is written.
  const at = SRC.indexOf('function promoCell');
  assert.ok(at > 0, 'promoCell has moved');

  const cell = withoutComments(SRC.slice(at, at + 900));
  assert.ok(!/expected/i.test(cell), 'the board cell has learned the word expected');
});

// --- and the columns that stay ----------------------------------------------

test('THE OPERATIONAL COLUMNS ARE ALL STILL THERE', () => {
  // "Do not remove important operational columns just to make the table
  // shorter." Status, clock, weight, price and payment each stay their own.
  const headings = boardHeadings();
  for (const column of ["'Status'", "'Clock'", "'Weight'", "'Promotion'", "'Price'", "'Payment'"]) {
    assert.match(headings, new RegExp(column), column);
  }
});

test('and the money columns still never reach a driver', () => {
  // A value that never reaches the page cannot leak from it - the rule the
  // board already kept, and one this reshuffle must not have loosened.
  // Plan joined them on 15 September. It belongs in this group rather than
  // beside Status: which plan a pickup is on is a pricing fact, and a driver
  // has no more use for it than for the price it implies.
  assert.match(
    boardHeadings(),
    /if \(showMoney\) headings\.push\('Plan', 'Promotion', 'Price', 'Payment'\)/
  );
  assert.match(boardRow(), /\.\.\.\(showMoney \?/);

  // And the row's money group carries exactly the four the headings promise.
  // A row and a heading list that disagree shift every column after the gap.
  assert.match(boardRow(), /showMoney \? \[planCell\(o\), promoCell\(o\), money\(o\.price_cents\), paymentBadge\(o\)\]/);
});

// --- the same shape one click away ------------------------------------------

test('THE CUSTOMER PAGE LISTS ORDERS THE SAME WAY', () => {
  // It ended in a generic "Open" link and carried one Pickup column, so the
  // two screens a click apart described the same order two different ways.
  // TO THE NEXT ROUTE, NOT TO A ROUND NUMBER. This read `at + 20000`, and the
  // handler grew past it the moment the intake table went in - so the test
  // failed on a screen that was perfectly correct, and had it been a little
  // shorter it would instead have passed while looking at half the handler.
  // Every window in this file is cut to a real boundary now.
  const at = SRC.indexOf("router.get('/ops/customers/:id'");
  const route = SRC.slice(at, SRC.indexOf('\nrouter.', at + 10));

  const headings = route.indexOf("['Order', 'Pickup date', 'Pickup time', 'Status', 'Weight'");
  assert.notEqual(headings, -1, 'the order history table does not match the board');

  const block = route.slice(headings, headings + 900);
  assert.match(block, /href="\/ops\/orders\/\$\{o\.order_number\}"/, 'it does not link by order number');
  assert.ok(!/>Open</.test(block), 'the generic Open link came back');
});
