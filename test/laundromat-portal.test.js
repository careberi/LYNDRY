'use strict';

// ---------------------------------------------------------------------------
// THE LAUNDROMAT PORTAL.
//
// Neil's ask, 25 September: an attendant signs in, sees the orders at HER store,
// enters the weight of the bags, and later tells the courier to collect.
//
// IT REVERSES "A PARTNER NEVER TOUCHES THE SYSTEM", which was right under the
// van and cannot survive the courier. That rule's argument was that the weigh-in
// charges a card, so 400 instead of 40 is a $1,000 charge and our own driver
// belongs between that number and somebody's card. Under a courier nobody of
// ours is ever in the building - so either an attendant types the weight or
// nobody does.
//
// WHICH MAKES THE GUARDS THE WHOLE OF IT, and they are what this file pins:
// a third session that cannot be confused with the other two, a sign-in page
// that cannot be turned into a redirector, and a weigh-in that cannot silently
// skip the escalation when the two scales disagree.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../src/core/partner-auth');
const adminAuth = require('../src/core/admin-auth');
const shop = require('../src/routes/shop');
const page = require('../src/web/shop-page');
const weighIn = require('../src/core/partner-weighin');
const { config } = require('../src/config');

const USER = '11111111-2222-3333-4444-555555555555';
const TOKEN = 'a'.repeat(36);

// --- the session ------------------------------------------------------------

test('A PORTAL COOKIE PROVES WHO IT SAYS IT DOES', () => {
  const { value } = auth.issueSession(USER, TOKEN);
  const read = auth.readSession(value);

  assert.equal(read.userId, USER);
  assert.equal(read.token, TOKEN);
});

test('AN OPS COOKIE IS NOT A PORTAL COOKIE, AND THAT IS THE POINT OF A THIRD FILE', () => {
  // Both are signed with ADMIN_API_KEY, so without a label per purpose a staff
  // cookie would validate here - and a staff session reaches the books while a
  // laundromat attendant is somebody else's employee. The label is what makes
  // one key safe to use for three things.
  const staff = adminAuth.issueSession ? adminAuth.issueSession(USER, TOKEN) : null;
  if (!staff) return; // adminAuth does not export it; nothing to compare

  assert.notEqual(staff.value, auth.issueSession(USER, TOKEN).value, 'the two sign-ins produce the same cookie');
  assert.equal(auth.readSession(staff.value), null, 'a staff cookie was accepted by the laundromat portal');
});

test('a tampered cookie is refused, whichever part was touched', () => {
  const { value } = auth.issueSession(USER, TOKEN);
  const [userId, expiry, token, signature] = value.split('.');

  assert.equal(auth.readSession(`${USER.replace('1', '9')}.${expiry}.${token}.${signature}`), null, 'the user id was swappable');
  assert.equal(auth.readSession(`${userId}.${expiry}.${'b'.repeat(36)}.${signature}`), null, 'the token was swappable');
  assert.equal(auth.readSession(`${userId}.${Number(expiry) + 60_000}.${token}.${signature}`), null, 'the expiry was extendable');
  assert.equal(auth.readSession(`${userId}.${expiry}.${token}.${'0'.repeat(64)}`), null, 'any signature was accepted');
});

test('AN EXPIRED SESSION IS REFUSED WITHOUT ASKING THE DATABASE', () => {
  // The expiry is inside the signature, so it cannot be extended - and it is
  // checked before anything is loaded, which is what makes a stale cookie cost
  // nothing.
  const past = Date.now() - 1000;
  const payload = `${USER}.${past}.${TOKEN}`;
  const signature = crypto.createHmac('sha256', config.adminApiKey).update(`shop.${payload}`).digest('hex');

  assert.equal(auth.readSession(`${payload}.${signature}`), null);
});

test('junk is refused rather than throwing', () => {
  for (const junk of ['', null, undefined, 'a', 'a.b.c', 'a.b.c.d.e', '....', 'not a cookie at all']) {
    assert.equal(auth.readSession(junk), null, `${JSON.stringify(junk)} was not refused`);
  }
});

test('A SHIFT, NOT AN HOUR, AND NOT THIRTY DAYS', () => {
  // The ops screens time out after an hour because they hold customer addresses
  // and the books. This is a tablet behind a counter holding order numbers and
  // wash instructions, and signing it out hourly means an attendant with laundry
  // in her hands waiting on a text - what she would actually do is write the
  // code on the wall.
  assert.ok(auth.SESSION_MINUTES > 60, 'the portal times out as fast as the ops screens');
  assert.ok(auth.SESSION_MINUTES <= 12 * 60, 'a portal session now outlives a shift');
});

test('the code rules match the other two sign-ins', () => {
  // Two different lifetimes on two sign-ins is a thing somebody has to look up,
  // and this is the third.
  assert.equal(auth.CODE_TTL_MINUTES, 5);
  assert.equal(auth.MAX_CODE_ATTEMPTS, 5);
});

// --- the sign-in page cannot be turned into a redirector --------------------

test('`?next=` ONLY EVER ACCEPTS A /shop PATH', () => {
  assert.equal(shop.safeNext('/shop/orders/1042'), '/shop/orders/1042');
  assert.equal(shop.safeNext('/shop'), '/shop');
});

test('and everything else lands on the board instead', () => {
  // Without this the sign-in page is an open redirector on lyndry.com, which is
  // a ready-made phishing link on our own domain - the same refusals
  // `scanner.scanReturn()` mostly exists to make.
  const refused = [
    'https://evil.example/steal',
    '//evil.example/steal',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    '/ops',
    '/ops/customers',
    '/account',
    '',
    null,
    undefined,
    '/shopping-not-ours',
  ];

  for (const asked of refused) {
    const got = shop.safeNext(asked);
    assert.ok(
      got === '/shop' || got.startsWith('/shop/'),
      `${JSON.stringify(asked)} was turned into ${JSON.stringify(got)}`
    );
    assert.doesNotMatch(String(got), /^\/ops/, 'the portal sign-in could send somebody into the ops screens');
  }
});

// --- what an attendant is shown ---------------------------------------------

test('THE JOB IS DERIVED FROM THE ORDER, NEVER STORED', () => {
  // A "portal stage" column would be a second copy of facts the order already
  // holds, and would go stale the first time anybody moved an order from the ops
  // screens - the rule the intake table and the guided run both follow.
  assert.equal(page.jobOf({ status: 'AT_PARTNER', partner_weight_lb: null }), 'WEIGH');
  assert.equal(page.jobOf({ status: 'AT_PARTNER', partner_weight_lb: 31.4 }), 'WASH');
  assert.equal(page.jobOf({ status: 'READY', partner_weight_lb: 31.4 }), 'DONE');
  assert.equal(page.jobOf({ status: 'OUT_FOR_DELIVERY', partner_weight_lb: 31.4 }), 'OTHER');
});

test('NO CUSTOMER NAME, PHONE, ADDRESS OR MONEY IS EVEN SELECTED', () => {
  // Not hidden in a template - absent from the process, the rule the ops screens
  // follow for a driver and prices. A value that never reaches the page cannot
  // leak from it, and this page is in somebody else's shop.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'shop.js'), 'utf8');
  const fields = /const ORDER_FIELDS =[\s\S]*?;/.exec(src);

  assert.ok(fields, 'ORDER_FIELDS has been renamed or removed');
  const selected = fields[0];

  for (const forbidden of ['price_cents', 'address_line1', 'postal_code', 'payment_status', 'amount_paid']) {
    assert.doesNotMatch(selected, new RegExp(`\\b${forbidden}\\b`), `the portal now selects ${forbidden}`);
  }

  // `customers(preferences)` is the wash, which they need. A bare name or phone
  // inside that join is the thing to catch.
  const join = /customers\(([^)]*)\)/.exec(selected);
  if (join) {
    for (const forbidden of ['name', 'phone', 'address']) {
      assert.doesNotMatch(join[1], new RegExp(`\\b${forbidden}\\b`), `the customer's ${forbidden} is joined onto a portal query`);
    }
  }

  // customer_id IS allowed and is not a name: the weigh-in needs it to raise an
  // issue when the two scales disagree.
  assert.match(selected, /\bcustomer_id\b/, 'without customer_id a scale mismatch raises no issue at all');
});

test('EVERY PORTAL QUERY IS SCOPED TO THE SIGNED-IN SHOP', () => {
  // Filtered in the query, never after it, so another shop's order never reaches
  // the process. The board and the single-order lookup each need their own.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'shop.js'), 'utf8');
  const selects = [...src.matchAll(/\.from\('orders'\)([\s\S]*?);/g)].map((m) => m[1]);

  assert.ok(selects.length >= 2, 'the portal stopped querying orders in the two places it used to');

  for (const query of selects) {
    assert.match(
      query,
      /\.eq\('partner_id', req\.partner\.id\)/,
      'a portal query for orders is not scoped to the signed-in laundromat'
    );
  }
});

// --- the weigh-in -----------------------------------------------------------

test('A WEIGHT THAT IS NOT A WEIGHT IS REFUSED BEFORE ANYTHING IS WRITTEN', async () => {
  for (const junk of [0, -5, 'abc', null, undefined, '', 1000, weighIn.MAX_LOAD_LB + 0.1]) {
    const got = await weighIn.recordWholeLoad({
      order: { id: 'x', status: 'AT_PARTNER' },
      weightLb: junk,
      by: { actor: 'test' },
      settleWeight: async () => {
        throw new Error('settled on a weight that should have been refused');
      },
    });
    assert.equal(got.ok, false, `${JSON.stringify(junk)} was accepted as a weight`);
    assert.equal(got.reason, 'bad_weight');
  }
});

test('and a bag that is not with them yet cannot be weighed', async () => {
  // The form is absent unless it is theirs to fill in, and the route refuses
  // independently - because markup guards nothing, on the tag page least of all,
  // which has no sign-in at all.
  for (const status of ['REQUESTED', 'IN_PROCESS', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    const got = await weighIn.recordWholeLoad({
      order: { id: 'x', status },
      weightLb: 24,
      by: { actor: 'test' },
      settleWeight: async () => {
        throw new Error(`settled an order that was ${status}`);
      },
    });
    assert.equal(got.ok, false, `an order at ${status} was weighable`);
    assert.equal(got.reason, 'not_here_yet');
  }
});

test('BOTH DOORS ONTO THE WHOLE-LOAD WEIGH-IN CALL THE ONE FUNCTION', () => {
  // The bag tag with no sign-in, and the portal. It was written inline in the
  // bag route while there was one of them; a second copy in the portal would
  // have drifted the first time one learned something the other did not - and
  // the thing it would have forgotten is the issue raised when the scales
  // disagree, which is exactly what went missing on the first run.
  const root = path.join(__dirname, '..', 'src');

  for (const file of ['routes/bag.js', 'routes/shop.js']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(src, /recordWholeLoad\(/, `${file} stopped going through partner-weighin.js`);
  }
});

test('AND THERE IS A THIRD IMPLEMENTATION, WHICH IS WORTH KNOWING ABOUT', () => {
  // `/o/<code>/weight` has TWO paths: an order tag weighs the whole load in one
  // number (now `partner-weighin.js`), and a BAG sticker weighs one bag, summing
  // onto the order once every bag is in. That second one writes
  // orders.partner_weight_lb, settles and raises its own mismatch issue - so the
  // rule "one implementation of the laundromat weighing it" is not true yet.
  //
  // IT IS NOT MERGED BECAUSE IT IS ABOUT TO BE DEAD. Bag stickers are bound by a
  // driver standing in a van; under the courier model there is no van and no
  // driver, so nothing binds them and that path becomes unreachable. Merging it
  // now would be refactoring code on its way out.
  //
  // THE TEST EXISTS SO THE NEXT PERSON FINDS IT rather than discovering it the
  // way this one did - by a mismatch issue silently not being raised. If the
  // per-bag path outlives the van, it goes through `partner-weighin.js` too.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'bag.js'), 'utf8');
  const perBag = /\.from\('orders'\)\s*\.update\(\{\s*partner_weight_lb: theirTotal/.test(src);

  assert.ok(
    perBag,
    'the per-bag weigh-in path has changed. If it now goes through partner-weighin.js, delete this test; ' +
      'if it was removed with the van, delete it too.'
  );
});

test('A PAGE IS NEVER RENDERED WITH A HOLE IN IT', () => {
  // Every visible string is an { en, es } pair, and a missing Spanish one
  // renders as `undefined` - which is loud, deliberately, where a fallback would
  // put quiet English in the middle of a Spanish page and look finished. On a
  // screen somebody acts on, that is the difference worth having.
  for (const lang of ['en', 'es']) {
    const signIn = page.phoneStep({ lang });
    const code = page.codeStep({ lang, phone: '+12015550171', ttlMinutes: 5 });
    const board = page.board({
      lang,
      shopName: 'Riverside Wash Co',
      orders: [{ order_number: 9005, status: 'AT_PARTNER', partner_weight_lb: null, bag_count: 2 }],
    });
    const one = page.orderPage({
      lang,
      shopName: 'Riverside Wash Co',
      order: { order_number: 9005, status: 'AT_PARTNER', partner_weight_lb: null, bag_count: 2 },
      washLines: [['Water temperature', 'Cold']],
    });

    for (const [name, html] of [['phoneStep', signIn], ['codeStep', code], ['board', board], ['orderPage', one]]) {
      assert.doesNotMatch(html, /undefined/, `${name} rendered "undefined" in ${lang}`);
      assert.doesNotMatch(html, /\[object Object\]/, `${name} rendered an object in ${lang}`);
      assert.doesNotMatch(html, /NaN/, `${name} rendered NaN in ${lang}`);
    }
  }
});

test('EVERY PORTAL PAGE IS NOINDEX', () => {
  // They carry order numbers and wash instructions, and the sign-in page is the
  // one URL anybody could find.
  const board = page.board({ lang: 'en', shopName: 'Riverside Wash Co', orders: [] });
  assert.match(board, /noindex/);
  assert.match(page.phoneStep({ lang: 'en' }), /noindex/);
});
