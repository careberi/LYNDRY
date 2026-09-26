'use strict';

// ---------------------------------------------------------------------------
// THE LAUNDROMAT PAGE: WHO CAN SIGN IN, AND WHAT REPLACED THE SCALE COMPARISON.
//
// Two asks from Neil on 26 September, both about the same screen:
//
//   "we are not weighing the orders anymore. There is no need for the Their
//    scale against ours check."
//
//   "Shouldnt the laundromat page have a spot for me to add the owner/admin of
//    the laudnromat url page. also i shoudl a link to that page and the ability
//    to sign into it as well."
//
// NOTHING RENDERED THIS CARD IN A TEST AND IT CRASHED ON FIRST RENDER. It called
// a bare `displayPhone()`, which this file imports as `format.displayPhone` - a
// ReferenceError, on a page an admin opens, found by rendering it by hand rather
// than by the 1,305 tests that were green. So the first thing here renders it.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { partnerDetailBody } = require('../src/web/partners-page');
const staffCore = require('../src/core/partner-staff');

const ROOT = path.join(__dirname, '..');

const SHOP = Object.freeze({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Riverside Wash Co',
  type: 'LAUNDROMAT',
  slug: 'riverside-wash-co',
  status: 'ACTIVE',
  wholesale_per_lb_cents: 85,
  address_line1: '148 Main St',
  city: 'Hackensack',
  state: 'NJ',
  postal_code: '07601',
});

const STAFF = Object.freeze([
  { id: 'a1', name: 'Maria Lopez', phone: '+12015550160', role: 'OWNER', status: 'ACTIVE' },
  { id: 'a2', name: 'Sam Patel', phone: '+12015550161', role: 'ATTENDANT', status: 'DISABLED' },
]);

const NO_HISTORY = { rows: [], total: 0, flagged: 0, meanDrift: 0, heavier: 0, lighter: 0 };

const render = (over = {}) =>
  partnerDetailBody({
    partner: SHOP,
    hours: [],
    load: null,
    notice: null,
    staff: STAFF,
    history: NO_HISTORY,
    weighed: { rows: [], orders: 12, totalLb: 342.5, meanLb: 28.5, meanPerBag: 19.4 },
    courierModel: true,
    ...over,
  });

// --- 1. it renders at all ---------------------------------------------------

test('THE PAGE RENDERS, WHICH IS NOT A GIVEN', () => {
  // The bug this exists for: `displayPhone(...)` instead of `format.displayPhone(...)`.
  // A ReferenceError thrown inside a template literal, on a page an admin opens,
  // with a fully green suite - because no test had ever rendered this card.
  assert.doesNotThrow(() => render(), 'the laundromat page throws while rendering');
  assert.doesNotThrow(() => render({ courierModel: false }), 'the van version throws');
  assert.doesNotThrow(() => render({ staff: [] }), 'a shop with nobody signed up throws');
  assert.doesNotThrow(() => render({ staff: [], weighed: null }), 'a shop with nothing at all throws');

  // And a partner that is not a laundromat has neither card and must not throw.
  assert.doesNotThrow(
    () => render({ partner: { ...SHOP, type: 'PROPERTY_MANAGER', slug: null } }),
    'a property manager throws'
  );
});

// --- 2. the portal, and who can open it -------------------------------------

test('IT NAMES THE SHOP PORTAL AND LINKS TO IT', () => {
  const html = render();

  assert.match(html, /Their portal/);
  assert.match(html, /\/shop\/riverside-wash-co/, 'the portal address is not on the page');
  assert.match(html, /Maria Lopez/, 'the owner is not listed');
  assert.match(html, /201-555-0160/, 'the number is not in the house format');
});

test('and a shop with no address yet says so rather than linking nowhere', () => {
  const html = render({ partner: { ...SHOP, slug: null } });

  assert.doesNotMatch(html, /href="\/shop\/(null|undefined)/, 'it links to a broken portal address');
  assert.match(html, /no portal address yet/i);
});

test('ONLY OPS MAY NAME AN OWNER, AND THE PAGE IS WHERE THAT RUNG IS', () => {
  const html = render();

  // The control exists here...
  assert.match(html, /Make owner|Make attendant/, 'the role cannot be changed from ops');

  // ...and the portal's own door cannot carry a role at all.
  const portal = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'shop.js'), 'utf8');
  assert.doesNotMatch(
    portal,
    /partnerStaff\.(add|setRole)\(/,
    'the portal reached the role-bearing door, so an owner can promote themselves'
  );
});

test('"sign into it as well" is answered without an impersonation feature', () => {
  // NEIL ASKED TO BE ABLE TO SIGN IN AND THE ANSWER IS THAT HE ALREADY CAN: add
  // his own number as an owner and sign in at the shop's address, as HIMSELF.
  // An impersonation feature would put his actions in an attendant's name, which
  // is the one thing a staff list exists to prevent - so the page says how
  // instead, and a test pins that nothing anywhere signs in as somebody else.
  const html = render();
  assert.match(html, /add your own number as an\s*owner/i, 'the page no longer says how to get in');

  // A LAUNDROMAT SESSION, NOT ANY SESSION. The first version matched
  // `setSessionCookie` outright and caught `admin-auth`'s own - which is Neil
  // signing in to ops as himself and is the point of the file. What must not exist
  // is ops minting a session for somebody else's PORTAL.
  const admin = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'admin.js'), 'utf8');

  assert.ok(
    !/partner-auth|partnerAuth|impersonat/i.test(admin),
    'ops can mint a laundromat session, so an admin can act as one of their staff'
  );
});

// --- 3. the scale comparison, and what replaced it --------------------------

test('THEIR SCALE AGAINST OURS IS ABSENT UNDER A COURIER, NOT HIDDEN', () => {
  // Neil: "we are not weighing the orders anymore." It follows from the model -
  // nobody of ours touches the bags, so `orders.weight_lb` is null for ever and
  // the comparison has one number in it.
  const html = render({ courierModel: true });

  assert.doesNotMatch(html, /Their scale against ours/, 'the van comparison still renders');
  assert.doesNotMatch(html, /Out by|Over tolerance/, 'the drift figures still render');

  // ABSENT, NEVER HIDDEN. The first version set `display:none` on that card, which
  // is the exact thing this codebase refuses: prices are left OUT of a driver's
  // markup rather than hidden with CSS, because a value that never reaches the
  // page cannot leak from it.
  assert.doesNotMatch(html, /display:none/, 'the card is hidden with CSS rather than left out');
});

test('and the van keeps it, because production still runs the van', () => {
  const html = render({
    courierModel: false,
    history: { ...NO_HISTORY, total: 0 },
  });

  assert.match(html, /Their scale against ours/, 'the van lost its comparison');
  assert.doesNotMatch(html, /What they have weighed/, 'the courier card renders under the van');
});

test('what replaces it says the check is gone, rather than quietly dropping it', () => {
  // THE LOST CONTROL IS NAMED. Under the van our scale checked theirs, which is
  // what made a shop running consistently heavy visible. A courier removes our
  // half, so the same unchecked figure bills the customer and pays the shop - and
  // this page is exactly where somebody would look for that check.
  const html = render({ courierModel: true });

  assert.match(html, /What they have weighed/);
  assert.match(html, /342\.5/, 'the pounds they have weighed are not shown');
  assert.match(html, /Nobody of ours weighs these bags/i, 'the missing check is not stated');
  assert.match(html, /per bag/i, 'the one signal left is not offered');
});

// --- 4. the shared rules ----------------------------------------------------

test('THE PORTAL AND OPS CALL THE SAME THREE FUNCTIONS', () => {
  // Two implementations of "add somebody to a shop" is how the buttons and the
  // JSON API would have drifted over "collected". The rules live in core and both
  // doors reach them.
  for (const fn of ['list', 'add', 'addAttendant', 'setStatus', 'setRole']) {
    assert.equal(typeof staffCore[fn], 'function', `partner-staff.${fn} is missing`);
  }

  const portal = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'shop.js'), 'utf8');
  const admin = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'admin.js'), 'utf8');

  assert.match(portal, /partnerStaff\./, 'the portal stopped using the shared rules');
  assert.match(admin, /partnerStaff\./, 'ops stopped using the shared rules');

  assert.ok(
    !/\.from\('partner_users'\)/.test(portal) && !/\.from\('partner_users'\)/.test(admin),
    'a route writes partner_users directly, beside the shared rules'
  );
});

test('and adding somebody texts nobody', () => {
  // They go on a list and sign in when they choose to. An unprompted text saying
  // "you have been added to a system" is a message nobody asked for.
  const core = fs.readFileSync(path.join(ROOT, 'src', 'core', 'partner-staff.js'), 'utf8');

  for (const sender of ['sendAndLog', 'notify', 'requestCode', 'sendMessage']) {
    assert.ok(!core.includes(sender), `partner-staff reaches for ${sender}`);
  }
});
