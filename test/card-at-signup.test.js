'use strict';

// ---------------------------------------------------------------------------
// CARD FIRST, AT SIGNUP.
//
// Neil, 16 September, from the real numbers: of 54 customers, six have a card
// on file and ALL SIX have ordered; forty five have no card and NONE of them
// has. "Card on file is the whole funnel; everything upstream of it is noise."
//
// TWO HALVES, AND ONLY ONE OF THEM IS NEW.
//
//   the enforcement   already there and unchanged: dispatch.collectable()
//                     keeps a cardless pickup off the round and
//                     fulfilment.collect() refuses it at the door, so a
//                     pickup cannot be finished without one. Pinned here
//                     because this is the branch that claims it
//   the capture       new: the card is offered on the page they land on,
//                     while they are still holding their phone
//
// WHAT MUST NOT HAPPEN, and each is a way this turns into something worse:
//
//   no plan by accident   saving a card enrols nobody in anything
//   no id in a URL        the button knows who from an httpOnly cookie, never
//                         from the address bar
//   no leak               a refused number, a throttle, a bot and an existing
//                         customer all get the identical page. A card button
//                         appearing only for real customers would turn the
//                         form into a way of finding out which
//   no session per view   a Stripe session is minted when the button is
//                         pressed, never while the page renders
//
// Nothing here touches the database, Stripe or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const signupCard = require('../src/core/signup-card');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const PAGE = (name) =>
  fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', name), 'utf8');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
    .join('\n');

const ID = '11111111-2222-3333-4444-555555555555';

// A stand-in for Express's res.cookie / req.headers.cookie.
function fakeRes() {
  const set = [];
  return {
    set,
    cookie: (name, value, options) => set.push({ name, value, options }),
    clearCookie: (name, options) => set.push({ name, value: '', options, cleared: true }),
  };
}

const withCookie = (value) => ({ headers: { cookie: `ly_signup=${value}` } });

// --- the marker -------------------------------------------------------------

test('the marker names the customer and nothing else', () => {
  const res = fakeRes();
  signupCard.remember(res, ID);

  assert.equal(res.set.length, 1);
  assert.equal(res.set[0].name, signupCard.COOKIE);
  assert.equal(res.set[0].value, ID);
  assert.equal(signupCard.recall(withCookie(ID)), ID);
});

test('it is httpOnly, same-site strict, and scoped to the signup pages', () => {
  const res = fakeRes();
  signupCard.remember(res, ID);
  const options = res.set[0].options;

  assert.equal(options.httpOnly, true, 'a script must never read it');
  assert.equal(options.sameSite, 'strict', 'it must never be sent from another site');
  assert.equal(options.path, signupCard.PATH);
  assert.ok(options.maxAge > 0 && options.maxAge <= 60 * 60 * 1000, 'minutes, not days');
});

test('anything that is not a customer id is refused rather than stored', () => {
  for (const bad of ['', null, undefined, 'not-a-uuid', '../../etc', '1', ID + 'x']) {
    const res = fakeRes();
    signupCard.remember(res, bad);
    assert.equal(res.set.length, 0, String(bad));
  }
});

test('a tampered cookie reads as nobody', () => {
  for (const bad of ['not-a-uuid', '', 'x'.repeat(200), '%%%']) {
    assert.equal(signupCard.recall(withCookie(bad)), null, bad);
  }
  assert.equal(signupCard.recall({ headers: {} }), null);
  assert.equal(signupCard.recall({}), null);
});

test('it is read out of a header with other cookies beside it', () => {
  const req = { headers: { cookie: `ly_popup=1; ly_signup=${ID}; ly_conv=abc` } };
  assert.equal(signupCard.recall(req), ID);
});

test('a cookie whose name merely ends in ours is not ours', () => {
  const req = { headers: { cookie: `not_ly_signup=${ID}` } };
  assert.equal(signupCard.recall(req), null);
});

// --- who gets offered the step ---------------------------------------------

test('the marker is set on a real new customer and nowhere else', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const start = src.indexOf("router.post('/start'");
  assert.ok(start > 0, 'the route is missing');
  // To the END of the route. There are several `return done();` in it - the
  // honeypot, the throttle, an unreadable number - so slicing to the first one
  // closes the window before the code this is about.
  const route = src.slice(start, src.indexOf('catch (err)', start));

  assert.ok(route.includes('signupCard.remember'), 'the step is never offered at all');

  // It must sit inside the same "a real new customer" branch the lead marker
  // does - that branch is what keeps a refusal indistinguishable from a save.
  const branch = route.slice(route.indexOf('if (result.ok && result.created)'));
  assert.ok(branch.includes('signupCard.remember(res, result.customer.id)'), branch);

  // And there is exactly one of them, so it cannot also be set on a refusal.
  assert.equal((route.match(/signupCard\.remember/g) || []).length, 1);
});

test('every outcome of the form still lands on the same page', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const start = src.indexOf("router.post('/start'");
  const route = src.slice(start, src.indexOf('catch (err)', start));

  // One destination, and no branch that sends a refusal somewhere else.
  assert.ok(route.includes("res.redirect(303, '/start/sent')"), route);
  assert.ok(!/redirect\(303, '\/start\/sent\?/.test(route), 'no state on the address bar');
});

test('the block is shown only with the marker AND payments switched on', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const at = src.indexOf("page.path === '/start/sent'");
  assert.ok(at > 0, 'the page has no card step');
  const branch = src.slice(at, at + 400);

  assert.ok(branch.includes('signupCard.recall(req)'), branch);
  assert.ok(branch.includes('billing.paymentsConfigured()'), 'a button with no Stripe behind it is worse than none');
});

test('the page carries the token and renders nothing when it is empty', () => {
  const page = PAGE('start-sent.html');

  assert.ok(page.includes('{{SIGNUP_CARD}}'), 'the page has no hole for the block');
  // And a page that never reaches the branch above still gets an empty string,
  // so the literal token can never appear on screen.
  const src = withoutComments(SRC('routes', 'web.js'));
  const fn = src.slice(src.indexOf('async function extraTokensFor'));
  assert.ok(/return \{ SIGNUP_CARD: '' \};/.test(fn.slice(0, fn.indexOf('\n}'))), 'no safe default');
});

// --- the button -------------------------------------------------------------

test('the card route enrols nobody in a plan', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const start = src.indexOf("router.post('/start/card'");
  assert.ok(start > 0, 'the route is missing');
  const route = src.slice(start, src.indexOf('catch (err)', start));

  for (const forbidden of ['subscription', 'recurring', 'addSchedule', 'bookPickup', 'plan']) {
    assert.ok(!route.includes(forbidden), `${forbidden} has no business in a card step`);
  }
});

test('it takes no money', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const start = src.indexOf("router.post('/start/card'");
  const route = src.slice(start, src.indexOf('catch (err)', start));

  for (const forbidden of ['charge', 'capture', 'authorizeShowUp', 'amount']) {
    assert.ok(!route.includes(forbidden), `${forbidden} - saving a card takes nothing`);
  }
  assert.ok(route.includes('createSetupLink'), route);
});

test('it refuses without the marker, and says nothing about why', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const start = src.indexOf("router.post('/start/card'");
  const route = src.slice(start, src.indexOf('catch (err)', start));

  assert.ok(route.includes('signupCard.recall(req)'), route);
  assert.ok(/if \(!id\) return res\.redirect\(303, '\/start\/sent'\);/.test(route), route);
  assert.ok(!route.includes('problem='), 'a refusal here must not describe itself');
});

test('somebody who already has a card is not sent round again', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const start = src.indexOf("router.post('/start/card'");
  const route = src.slice(start, src.indexOf('catch (err)', start));

  assert.ok(route.includes('customer.payment_method_id'), route);
});

test('the Stripe session is minted on the press, never on a page view', () => {
  const src = withoutComments(SRC('routes', 'web.js'));

  // The only createSetupLink in this file is inside the POST.
  const calls = [...src.matchAll(/createSetupLink/g)].map((m) => m.index);
  assert.equal(calls.length, 1, 'more than one place mints a session');

  const postAt = src.indexOf("router.post('/start/card'");
  const postEnd = src.indexOf('catch (err)', postAt);
  assert.ok(calls[0] > postAt && calls[0] < postEnd, 'a session is minted outside the button press');
});

test('the button is a form post, not a link carrying anything', () => {
  const src = SRC('routes', 'web.js');
  const block = src.slice(src.indexOf('function signupCardBlock'), src.indexOf('async function extraTokensFor'));

  assert.ok(block.includes('method="post"'), block);
  assert.ok(block.includes('action="/start/card"'), block);
  // No id, token or phone anywhere in the markup.
  assert.ok(!/\{\{PHONE\}\}|customer|token|\?id=/.test(block), block);
});

test('nothing puts a customer id or a token on the address bar', () => {
  const src = withoutComments(SRC('routes', 'web.js'));
  const start = src.indexOf("router.post('/start/card'");
  const route = src.slice(start, src.indexOf('catch (err)', start));

  assert.ok(!/redirect\([^)]*\$\{[^}]*id[^}]*\}/.test(route), 'an id reached a URL');
  // The one redirect that carries anything is Stripe's own hosted page.
  assert.ok(route.includes('link.url'), route);
});

// --- the half that was already there ---------------------------------------

// The capture above is worth nothing on its own. These are the rules that make
// "they cannot finish a pickup" true, and they are unchanged by this branch -
// pinned because it is this branch that claims them.
test('a cardless pickup is still kept off the round and refused at the door', () => {
  const dispatch = withoutComments(SRC('core', 'dispatch.js'));
  assert.ok(dispatch.includes('needsCardOnFile'), 'collectable() no longer asks about a card');

  const fulfilment = withoutComments(SRC('core', 'fulfilment.js'));
  const collect = fulfilment.slice(fulfilment.indexOf('async function collect('));
  assert.ok(
    collect.slice(0, 2500).includes('collectRefusal') || collect.slice(0, 2500).includes('collectable'),
    'the door no longer checks'
  );
});

test('saving a card still books nothing by itself', () => {
  const src = withoutComments(SRC('core', 'card-saved.js'));

  for (const forbidden of ['addSchedule', 'subscriptions', 'recurring.add']) {
    assert.ok(!src.includes(forbidden), `${forbidden} would enrol somebody who only added a card`);
  }
});

// --- and it still says nothing to anybody ----------------------------------

test('the signup card module cannot text, charge or write anything', () => {
  const src = withoutComments(SRC('core', 'signup-card.js'));

  for (const forbidden of ['notify', 'sendMessage', 'db.', 'insert', 'stripe']) {
    assert.ok(!src.includes(forbidden), `${forbidden} - this module only remembers who just signed up`);
  }
});
