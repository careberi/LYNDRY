'use strict';

// ---------------------------------------------------------------------------
// A LAUNDROMAT'S OWN URL.
//
// Neil, 25 September: "when I add a laundromat, they should get their own url
// that they can log into".
//
// `/shop/riverside-wash-co` is what a shop bookmarks on the tablet behind the
// counter. IT IS NOT A CREDENTIAL - signing in still needs a texted six-digit
// code - so what it has to be is memorable, typable, and unable to collide with
// the portal's own paths.
//
// THE COLLISION IS THE ONE THAT WOULD BE FOUND LATE. Express answers whichever
// route was declared first, so a laundromat that slugged to `orders` would
// shadow `/shop/orders/9005` or be shadowed by it, depending on declaration
// order - and the symptom is one shop's portal quietly not working.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const partners = require('../src/core/partners');

test('A NAME BECOMES SOMETHING YOU CAN TYPE AND READ OUT', () => {
  assert.equal(partners.slugify('Riverside Wash Co'), 'riverside-wash-co');
  assert.equal(partners.slugify('Fold & Fluff Bergen'), 'fold-and-fluff-bergen');
  assert.equal(partners.slugify('Route 17 Laundry'), 'route-17-laundry');
  assert.equal(partners.slugify("Maria's Laundromat"), 'marias-laundromat');
  assert.equal(partners.slugify('  Spaced   Out  '), 'spaced-out');
});

test('and an accent is folded rather than dropped', () => {
  // "Lavandería" must become lavanderia, not lavandera - dropping the letter
  // changes the word, and this one is going on a card in a shop window.
  assert.equal(partners.slugify('Lavanderia Jimenez'), 'lavanderia-jimenez');
  assert.equal(partners.slugify('Lavandería Jiménez'), 'lavanderia-jimenez');
  assert.equal(
    partners.slugify('Lavandería Jiménez'),
    partners.slugify('Lavanderia Jimenez'),
    'the same shop typed two ways gets two different URLs'
  );
});

test('A SLUG NEVER SHADOWS A PATH THE PORTAL USES', () => {
  // The failure this prevents: a shop called "Orders" taking /shop/orders and
  // colliding with /shop/orders/9005. Whichever route Express declared first
  // wins, and the loser is a screen that quietly stops working.
  for (const word of ['Orders', 'Login', 'Logout', 'Team', 'Admin', 'API', 'New']) {
    const slug = partners.slugify(word);
    assert.notEqual(slug, word.toLowerCase(), `a laundromat could take /shop/${word.toLowerCase()}`);
    assert.match(slug, /^[a-z0-9-]+$/);
  }

  assert.equal(partners.slugify('Orders'), 'orders-laundromat');
});

test('and a real name that merely contains a reserved word is untouched', () => {
  // Only an EXACT collision is a problem. "New Jersey Laundry" is not /shop/new.
  assert.equal(partners.slugify('New Jersey Laundry'), 'new-jersey-laundry');
  assert.equal(partners.slugify('Team Clean'), 'team-clean');
});

test('IT IS ALWAYS URL-SAFE, WHATEVER IS TYPED INTO THE NAME BOX', () => {
  const nasty = [
    'Wash & Go!!!',
    '../../etc/passwd',
    '<script>alert(1)</script>',
    'A  B   C',
    'Laundry   ---   Co',
    '100% Clean',
    'Ñoño Lavandería #1',
  ];

  for (const name of nasty) {
    const slug = partners.slugify(name);
    if (slug === null) continue;
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `"${name}" produced an unsafe slug: ${slug}`);
    assert.equal(slug, encodeURIComponent(slug), `"${name}" produced a slug that needs escaping`);
  }
});

test('a name with nothing usable in it has no slug rather than a bad one', () => {
  // Null is a real answer: the partner is saved, they simply have no portal URL
  // until somebody gives them a name with letters in it.
  assert.equal(partners.slugify(''), null);
  assert.equal(partners.slugify('   '), null);
  assert.equal(partners.slugify('!!!'), null);
  assert.equal(partners.slugify(null), null);
  assert.equal(partners.slugify(undefined), null);
});

test('IT IS CAPPED, BECAUSE A URL GETS READ OUT OVER THE PHONE', () => {
  const long = partners.slugify('The Very Long Name Of A Laundromat That Somebody Typed In Full Without Stopping');

  assert.ok(long.length <= 60, `slug was ${long.length} characters`);
  assert.doesNotMatch(long, /-$/, 'the cap left a trailing hyphen');
});

test('the reserved list is exported, so the router and the slug cannot disagree', () => {
  // If a path is added to the portal, it goes in this one list. Two copies is
  // how a shop ends up with a URL that shadows a screen.
  assert.ok(Array.isArray(partners.RESERVED_SLUGS));
  assert.ok(partners.RESERVED_SLUGS.includes('orders'));
  assert.ok(partners.RESERVED_SLUGS.includes('login'));
});
