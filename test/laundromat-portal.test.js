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
const SHOP = { id: 'aaaa', name: 'Riverside Wash Co', slug: 'riverside-wash-co' };
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

  // OUT_FOR_DELIVERY IS ITS OWN STATE NOW, and it used to fall through to the
  // catch-all reading "being washed" - which is wrong on a counter where the
  // bags have physically gone. An attendant who cannot see that a courier has
  // taken them rings us to ask.
  assert.equal(page.jobOf({ status: 'OUT_FOR_DELIVERY', partner_weight_lb: 31.4 }), 'GONE');
  assert.equal(page.jobOf({ status: 'IN_PROCESS', partner_weight_lb: null }), 'OTHER');
});

test('NO CUSTOMER NAME, PHONE OR ADDRESS IS EVEN SELECTED', () => {
  // Not hidden in a template - absent from the process, the rule the ops screens
  // follow for a driver and prices. A value that never reaches the page cannot
  // leak from it, and this page is in somebody else's shop.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'shop.js'), 'utf8');
  const fields = /const ORDER_FIELDS =[\s\S]*?';$/m.exec(src);

  assert.ok(fields, 'ORDER_FIELDS has been renamed or removed');
  const selected = fields[0];

  for (const forbidden of ['address_line1', 'postal_code']) {
    assert.doesNotMatch(selected, new RegExp(forbidden), `the portal now selects ${forbidden}`);
  }

  // `customers(preferences)` is the wash, which they need. A name or a phone
  // inside that join is the thing to catch.
  const join = /customers\(([^)]*)\)/.exec(selected);
  if (join) {
    for (const forbidden of ['name', 'phone', 'address']) {
      assert.doesNotMatch(
        join[1],
        new RegExp(forbidden),
        `the customer's ${forbidden} is joined onto a portal query`
      );
    }
  }

  // customer_id IS allowed and is not a name: the weigh-in needs it to raise an
  // issue when the two scales disagree.
  assert.match(selected, /\bcustomer_id\b/, 'without customer_id a scale mismatch raises no issue at all');
});

test('AN ORDER CARRIES ITS OWN MONEY AND NEVER SHOWS IT, AND THAT IS A REFINEMENT', () => {
  // THIS TEST USED TO REFUSE THE MONEY COLUMNS OUTRIGHT, on the reasoning that a
  // value which never reaches the page cannot leak from it. That is exactly
  // right for a CUSTOMER's name and address, which nothing here needs.
  //
  // It is wrong for the ORDER's own money, and holding it cost a real bug: the
  // portal hands the order to `settleWeight()`, which reads `price_per_lb_cents`
  // to price it and falls back to today's default rate when it is missing - so a
  // subscriber sold $1.80 would have been billed at $2.00. There is no way to
  // price an order without its own rate.
  //
  // SO THE RULE MOVED FROM "NOT SELECTED" TO "NOT RENDERED", which is where it
  // belongs: what a caller must load is decided by the function it calls, and
  // what a page may show is decided by who is reading it.
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'shop-page.js'), 'utf8');

  const money = [
    'price_cents',
    'price_per_lb_cents',
    'minimum_cents',
    'deposit_cents',
    'surcharge_cents',
    'discount_cents',
    'amount_paid_cents',
    'payment_status',
    'wholesale_per_lb_cents',
  ];

  for (const field of money) {
    assert.doesNotMatch(
      page,
      new RegExp(field),
      `the laundromat's pages read ${field} - an attendant must never be shown money`
    );
  }

  // And no currency anywhere on the screens they see.
  assert.doesNotMatch(page, /\$\$\{/, 'a dollar figure is being rendered on a laundromat screen');
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
      shop: SHOP,
      orders: [{ order_number: 9005, status: 'AT_PARTNER', partner_weight_lb: null, bag_count: 2 }],
    });
    const one = page.orderPage({
      lang,
      shop: SHOP,
      order: { order_number: 9005, status: 'AT_PARTNER', partner_weight_lb: null, bag_count: 2 },
      washLines: [['Water temperature', 'Cold']],
      canSendCourier: true,
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
  const board = page.board({ lang: 'en', shop: SHOP, orders: [] });
  assert.match(board, /noindex/);
  assert.match(page.phoneStep({ lang: 'en' }), /noindex/);
});

test('THE WASH INSTRUCTIONS ARE IN THE PAGE\'S LANGUAGE', () => {
  // It shipped without this: a Spanish page whose wash instructions were in
  // English - the one part an attendant actually acts on. `wash.washLines()` is
  // the shared definition and returns English, so the page translates it through
  // the same vocabulary the bag tag under it uses.
  const order = { order_number: 9006, status: 'READY', partner_weight_lb: 31.4, bag_count: 3 };
  const lines = [
    ['Water temperature', 'Cold'],
    ['Fabric softener', 'Standard scented'],
    ['Detergent', 'Standard'],
  ];

  const es = page.orderPage({ lang: 'es', shop: SHOP, order, washLines: lines });

  assert.match(es, /Temperatura del agua/, 'the wash instructions are still English on the Spanish page');
  assert.match(es, /Suavizante/);
  assert.doesNotMatch(es, /Water temperature/, 'an English wash label survived on the Spanish page');
  assert.doesNotMatch(es, /Fabric softener/);

  // And English is untouched.
  const en = page.orderPage({ lang: 'en', shop: SHOP, order, washLines: lines });
  assert.match(en, /Water temperature/);
  assert.doesNotMatch(en, /Temperatura/);
});

test('ONE SPANISH VOCABULARY FOR EVERY LAUNDROMAT SCREEN', () => {
  // It lived in routes/bag.js while the bag tag was the only screen a laundromat
  // saw. Two copies would be two vocabularies for one person, one tap apart.
  const root = path.join(__dirname, '..', 'src');

  for (const file of ['routes/bag.js', 'web/shop-page.js']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(src, /laundromat-es/, `${file} no longer reads the shared Spanish`);
    assert.doesNotMatch(
      src,
      /^const ES = Object\.freeze\(\{/m,
      `${file} has grown its own Spanish table again`
    );
  }
});

// --- the shop's own URL, its owner, and its staff ---------------------------

test('THE STAFF TAB IS AN OWNER\'S, AND THE ROUTE CHECKS TOO', () => {
  const shop = { id: 'a', name: 'Riverside Wash Co', slug: 'riverside-wash-co' };

  assert.doesNotMatch(page.shopNav('en', { isOwner: false }), /\/shop\/staff/);
  assert.match(page.shopNav('en', { isOwner: true }), /\/shop\/staff/);

  // A MENU THAT HIDES A LINK WHOSE ROUTE STILL FIRES IS NOT A GUARD. Every
  // staff route carries requireOwner, not just the nav.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'shop.js'), 'utf8');
  const staffRoutes = [...src.matchAll(/router\.(get|post)\('\/shop\/staff[^']*',\s*([^,]+),/g)];

  assert.ok(staffRoutes.length >= 3, `found ${staffRoutes.length} staff routes`);
  for (const [, method, guard] of staffRoutes) {
    assert.equal(guard.trim(), 'requireOwner', `a ${method} staff route is not behind requireOwner`);
  }
});

test('AN OWNER CANNOT MINT ANOTHER OWNER', () => {
  // The whole point of the split: LYNDRY says who owns a shop, the owner says
  // who works there. So the worst an owner can do is add and remove people at
  // the shop they already run.
  //
  // THE RULES MOVED TO `src/core/partner-staff.js` when the ops screen became a
  // second door onto the same act - Neil asked for the owner to be settable from
  // the laundromat page, and a second copy of "add somebody to a shop" is how two
  // doors drift. So this asserts the SHAPE that makes it impossible rather than a
  // string in a route file: the portal's door has no argument for a role.
  const portal = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'shop.js'), 'utf8');
  const core = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'partner-staff.js'), 'utf8');

  assert.match(portal, /addAttendant\(/, 'the portal no longer goes through the attendant-only door');

  assert.doesNotMatch(
    portal,
    /role:\s*(req\.body|body)\.|partnerStaff\.add\(|setRole\(/,
    'the portal can name a role, so an owner can promote themselves'
  );

  // And that door really cannot carry one.
  const fn = /async function addAttendant\([\s\S]*?\n}/.exec(core);
  assert.ok(fn, 'addAttendant() has been renamed or removed');
  assert.match(fn[0], /role: ROLES\.ATTENDANT/, 'addAttendant no longer pins the role');
  assert.ok(!/\brole\b\s*[,}]/.test(fn[0].split('{')[0]), 'addAttendant now takes a role argument');
});

test('EVERY STAFF WRITE IS SCOPED TO THE SHOP, IN THE QUERY', () => {
  // Somebody typing another laundromat's user id into the address bar must change
  // nothing there. Filtered in the query, never after it - the same rule the
  // portal's order lookups follow.
  //
  // IT READS THE CORE MODULE NOW, and that is where it matters more: both the
  // portal and the ops screen reach these writes, so a missing scope would be one
  // bug in two places.
  const core = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'partner-staff.js'), 'utf8');
  const writes = [...core.matchAll(/\.from\('partner_users'\)([\s\S]*?);/g)].map((m) => m[1]);

  assert.ok(writes.length >= 3, `only found ${writes.length} partner_users queries`);

  for (const q of writes) {
    assert.match(
      q,
      /partner_id: partnerId|\.eq\('partner_id', partnerId\)/,
      'a partner_users query is not scoped to one laundromat'
    );
  }

  // AND THE PORTAL NO LONGER WRITES DIRECTLY AT ALL, which is what stops the two
  // doors drifting.
  const portal = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'shop.js'), 'utf8');
  assert.ok(
    !/\.from\('partner_users'\)/.test(portal),
    'the portal reaches partner_users directly again, beside the shared rules'
  );
});

test('A RESERVED SLUG FALLS THROUGH, IT DOES NOT REDIRECT', () => {
  // `/shop/:slug` is declared before the sign-in guard, so it sits in front of
  // `/shop/staff` in the route table. Redirecting on a reserved word made the
  // Staff page unreachable - an owner tapping their own nav landed back on the
  // sign-in page. It must call next() so Express reaches the real route.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'shop.js'), 'utf8');
  const slugRoute = /router\.get\('\/shop\/:slug'[\s\S]*?\n}\);/.exec(src);

  assert.ok(slugRoute, 'the slug route has been renamed or removed');
  assert.match(
    slugRoute[0],
    /RESERVED_SLUGS\.includes\(asked\)[\s\S]{0,80}return next\(\)/,
    'a reserved slug redirects again, which hides every fixed path declared after it'
  );
});

test('and every fixed portal path is in the reserved list', () => {
  // The list and the router cannot be allowed to disagree: a laundromat that
  // slugged to one of these would shadow a screen, or be shadowed by one.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'shop.js'), 'utf8');
  const partners = require('../src/core/partners');

  const firstSegments = new Set(
    [...src.matchAll(/router\.(?:get|post)\('\/shop\/([a-z0-9.-]+)/g)].map((m) => m[1])
  );

  for (const segment of firstSegments) {
    // A SEGMENT WITH A DOT IN IT CAN NEVER BE A SLUG, so it needs no reserving:
    // `slugify()` strips dots and the route only matches [a-z0-9-]. That is why
    // /shop/app.webmanifest is safe without being on the list - and why reading
    // this as "app" would have been wrong, since /shop/app is not a real path.
    if (segment.includes('.')) continue;

    assert.ok(
      partners.RESERVED_SLUGS.includes(segment),
      `/shop/${segment} is a real path but "${segment}" is not reserved, so a laundromat could take it`
    );
  }
});

test('THE PORTAL HAS ITS OWN HOME-SCREEN MANIFEST, SCOPED TO /shop', () => {
  // Sharing /ops/app.webmanifest would give a laundromat's tablet an app scoped
  // to /ops, opening on the driver's route, bouncing to a sign-in they can
  // never pass.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'shop.js'), 'utf8');
  const manifest = /router\.get\('\/shop\/app\.webmanifest'[\s\S]*?\n}\);/.exec(src);

  assert.ok(manifest, 'the portal has no manifest route');
  assert.match(manifest[0], /scope: '\/shop'/);
  assert.match(manifest[0], /start_url: '\/shop'/);

  const rendered = page.board({ lang: 'en', shop: SHOP, orders: [] });
  assert.match(rendered, /href="\/shop\/app\.webmanifest"/);
  assert.doesNotMatch(rendered, /\/ops\/app\.webmanifest/, 'the portal links the ops manifest');
});

test('THE PORTAL WEARS THE OPS SKIN, WHICH IS WHAT WAS ASKED FOR', () => {
  // Neil: "the style of the laundromat back end should be the exact same style
  // as the /ops backend". The look is public/css/ops.css plus ops-terminal on
  // the body, and the portal loaded neither for a day - which is why it looked
  // like the marketing site.
  const rendered = page.board({ lang: 'en', shop: SHOP, orders: [] });

  assert.match(rendered, /ops\.css/, 'the portal is not loading the ops stylesheet');
  assert.match(rendered, /class="ops-terminal ops-touch"/, 'the portal is not wearing the terminal skin');

  // AND NOT A SINGLE /ops LINK. An attendant must never be offered an internal
  // screen - the shell cannot see a user, so it cannot derive a driver's nav.
  const opsLinks = [...rendered.matchAll(/href="(\/ops[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(opsLinks, [], `the portal links internal screens: ${opsLinks.join(', ')}`);
});
