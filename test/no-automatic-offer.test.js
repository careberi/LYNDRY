'use strict';

// ---------------------------------------------------------------------------
// THE 50% IS NOT ADVERTISED AND NOT GIVEN OUT, AND CLEAN50 STILL WORKS.
//
// Neil's decision lock, 22 September: the offer is no longer advertised or
// automatically assigned to new customers, and CLEAN50 remains valid when a
// customer explicitly provides the code.
//
// The whole of that turns on one field on one row - the audience - so most of
// what is worth pinning is the code that reads it:
//
//   autoGrant()          the single ACTIVE promotion with audience NEW_NUMBERS,
//                        read by the only automatic grant point and by the popup
//   claimableByCode()    audience-blind ON PURPOSE. This is the line that keeps
//                        a typed CLEAN50 working, and it reads like a missing
//                        filter somebody would tidy away
//   standDown()          the switch, which also takes the popup down
//   the pages            no discount typed onto a page, where nothing can honour it
//
// The database is a stub: nothing here reads or writes a real row.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const SRC = (...bits) => fs.readFileSync(path.join(ROOT, ...bits), 'utf8').split('\r\n').join('\n');
// Comments are where this file's own history is written, and the history
// mentions the offer by name - so they come out before anything is asserted.
const code = (src) =>
  src
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');

const promotions = require('../src/core/promotions');

// --- nothing advertises it ------------------------------------------------------

test('NO PAGE PROMISES A FIRST-ORDER DISCOUNT, because nothing would honour one', () => {
  const pages = fs.readdirSync(path.join(ROOT, 'public', 'pages')).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length > 5, 'the pages moved');

  for (const page of pages) {
    const markup = code(SRC('public', 'pages', page));
    assert.ok(!/% off your first/i.test(markup), `${page} advertises a first-order discount`);
    assert.ok(!/CLEAN50/i.test(markup), `${page} names the code`);
    assert.ok(!/\b50% off\b/i.test(markup), `${page} advertises 50% off`);
  }

  // The snippet a link preview and a search result show is the same promise.
  const web = code(SRC('src', 'routes', 'web.js'));
  const at = web.indexOf('const BERGEN_DESCRIPTION');
  const description = web.slice(at, web.indexOf(';', at));
  assert.ok(!/% off/i.test(description), description);
});

test('the offer sentence comes off the promotion, never off a page', () => {
  // popupOffer() builds the headline from the promotion's own blurb, and
  // answers nothing at all when there is no automatic promotion - which is what
  // makes the popup disappear rather than needing a second switch.
  assert.equal(promotions.popupOffer(null), null);
  assert.equal(promotions.popupOffer(undefined), null);

  const popup = code(SRC('src', 'web', 'popup.js'));
  assert.ok(!/50|CLEAN/i.test(popup), 'the popup markup names an offer of its own');
});

test('the popup needs BOTH the switch and an automatic promotion', () => {
  const sitePopup = code(SRC('src', 'core', 'site-popup.js'));
  const at = sitePopup.indexOf('async function offer(');
  const body = sitePopup.slice(at, sitePopup.indexOf('\n}', at));
  assert.ok(body.includes('settings.websitePopup()'), body);
  assert.ok(body.includes('promotions.autoGrant()'), body);
});

// --- nothing grants it unprompted -----------------------------------------------

test('THERE IS ONE AUTOMATIC GRANT POINT, AND IT ASKS FOR audience NEW_NUMBERS', () => {
  const promos = code(SRC('src', 'core', 'promotions.js'));
  const at = promos.indexOf('async function autoGrant(');
  const body = promos.slice(at, promos.indexOf('\n}', at));
  assert.ok(body.includes("eq('audience', 'NEW_NUMBERS')"), body);
  assert.ok(body.includes("eq('status', 'ACTIVE')"), body);

  // startConversation is the only caller that grants, and a code the customer
  // gave beats it rather than joining it.
  const onboarding = code(SRC('src', 'core', 'onboarding.js'));
  assert.ok(onboarding.includes('claimed || (await promotions.autoGrant())'), 'the automatic grant moved');
  assert.equal((onboarding.match(/promotions\.autoGrant\(\)/g) || []).length, 1, 'a second automatic grant point');

  // And nothing else asks who the automatic promotion is: granting it,
  // advertising it, and standing the previous one down when a replacement is
  // created. A fourth caller is a fourth way somebody is given something.
  const callers = [];
  for (const dir of ['core', 'routes']) {
    for (const file of fs.readdirSync(path.join(ROOT, 'src', dir))) {
      if (!file.endsWith('.js')) continue;
      if (/promotions\.autoGrant\(/.test(code(SRC('src', dir, file)))) callers.push(file);
    }
  }
  assert.deepEqual(callers.sort(), ['admin.js', 'onboarding.js', 'site-popup.js'], callers.join(', '));
});

// --- but a code still works ------------------------------------------------------

test('A TYPED CODE IS AUDIENCE-BLIND, WHICH IS WHAT KEEPS CLEAN50 ALIVE', () => {
  const promos = code(SRC('src', 'core', 'promotions.js'));
  const at = promos.indexOf('async function claimableByCode(');
  const body = promos.slice(at, promos.indexOf('\n}', at));

  assert.ok(body.includes("eq('status', 'ACTIVE')"), body);
  assert.ok(body.includes("not('code', 'is', null)"), body);
  // THE MISSING FILTER IS THE FEATURE. It reads like an oversight and is the
  // one line standing between a customer and the code they were told to text.
  assert.ok(!/audience/.test(body), 'claimableByCode filters on the audience again');
});

test('and ending a promotion is NOT how one is retired, because that kills the code', () => {
  // claimableByCode() takes ACTIVE only, so "Stop giving it out" would take the
  // code with it. The stand-down is a different button on purpose.
  const admin = code(SRC('src', 'routes', 'admin.js'));
  const at = admin.indexOf("router.post('/ops/promotions/:id/stand-down'");
  assert.notEqual(at, -1, 'there is no way to stop giving a promotion out');
  const route = admin.slice(at, admin.indexOf('\n});', at));
  assert.ok(!/ENDED/.test(route), 'standing down ends the promotion');
  assert.ok(route.includes('promotions.standDown('), route);
});

// --- the switch -------------------------------------------------------------------

// promotions.js against a stub database, so the update itself can be read.
function promotionsWith({ promo, moved = true }) {
  const log = { updates: [], popup: [] };

  const query = (table) => {
    const state = { table, filters: [], payload: null, op: 'select' };
    const api = {
      select() { return api; },
      update(payload) { state.op = 'update'; state.payload = payload; return api; },
      eq(col, value) { state.filters.push([col, value]); return api; },
      limit() { return api; },
      order() { return api; },
      maybeSingle() {
        if (state.op === 'update') {
          log.updates.push({ table, payload: state.payload, filters: state.filters });
          return Promise.resolve({ data: moved ? { ...promo, audience: 'SPECIFIC' } : null, error: null });
        }
        return Promise.resolve({ data: promo, error: null });
      },
      then(resolve) { return Promise.resolve({ data: promo ? [promo] : [], error: null }).then(resolve); },
    };
    return api;
  };

  const db = { from: query };

  const saved = { ...require.cache };
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(path.join(ROOT, 'src'))) delete require.cache[key];
  }
  const stub = (rel, exports) => {
    const p = require.resolve(path.join(ROOT, 'src', rel));
    require.cache[p] = new Module(p, null);
    require.cache[p].filename = p;
    require.cache[p].loaded = true;
    require.cache[p].exports = exports;
  };
  stub('db.js', db);
  stub(path.join('core', 'settings.js'), {
    setWebsitePopup: (on, by) => { log.popup.push({ on, by }); return Promise.resolve({}); },
    websitePopup: () => Promise.resolve(false),
  });
  stub(path.join('core', 'site-popup.js'), { forget: () => log.popup.push({ forgot: true }) });

  const mod = require(path.join(ROOT, 'src', 'core', 'promotions.js'));
  return {
    mod,
    log,
    restore() {
      for (const key of Object.keys(require.cache)) delete require.cache[key];
      Object.assign(require.cache, saved);
    },
  };
}

const CLEAN50 = {
  id: '0d0cc597-79a3-46da-b17a-ff844b29f4e9',
  name: 'CLEAN50 - 50% off first order',
  code: 'CLEAN50',
  audience: 'NEW_NUMBERS',
  status: 'ACTIVE',
  kind: 'PERCENT_OFF',
  value: 50,
  blurb: '50% off your first order',
  applies_to: 'FIRST_ORDER',
  expires_days: 30,
};

test('STANDING IT DOWN MOVES THE AUDIENCE AND TAKES THE POPUP WITH IT', async () => {
  const { mod, log, restore } = promotionsWith({ promo: CLEAN50 });
  try {
    const done = await mod.standDown(CLEAN50.id, { by: 'u1' });
    assert.equal(done.ok, true);
    assert.equal(done.code, 'CLEAN50', 'the code has to survive, and be sayable in the reply');

    const update = log.updates.find((u) => u.table === 'promotions');
    assert.ok(update, 'nothing was written');
    assert.deepEqual(update.payload, { audience: 'SPECIFIC', auto_grant: false });
    // Only this row, and only while it is still the automatic one.
    assert.deepEqual(update.filters, [['id', CLEAN50.id], ['audience', 'NEW_NUMBERS']]);

    // NOTHING ELSE IS TOUCHED: no grant, no order, no status.
    assert.ok(!('status' in update.payload), 'it ends the promotion');
    assert.deepEqual(log.updates.filter((u) => u.table !== 'promotions'), []);

    // And the website comes down in the same call - the ops switch only renders
    // for the automatic promotion, so leaving it would strand it on.
    assert.deepEqual(log.popup, [{ on: false, by: 'u1' }, { forgot: true }]);
  } finally {
    restore();
  }
});

test('it refuses anything that is not the automatic one, and a second press', async () => {
  const notAuto = promotionsWith({ promo: { ...CLEAN50, audience: 'SPECIFIC' } });
  try {
    const done = await notAuto.mod.standDown(CLEAN50.id);
    assert.equal(done.ok, false);
    assert.equal(done.reason, 'not_automatic');
    assert.equal(notAuto.log.updates.length, 0);
    assert.equal(notAuto.log.popup.length, 0, 'it took the website down for a promotion that was not on it');
  } finally {
    notAuto.restore();
  }

  // Two people, two screens: the loser is told, and the audience is not written
  // twice. The popup clear runs first and is idempotent - taking a website
  // switch off that somebody else has already taken off costs nothing, and the
  // alternative ordering is what strands it on.
  const raced = promotionsWith({ promo: CLEAN50, moved: false });
  try {
    const done = await raced.mod.standDown(CLEAN50.id);
    assert.equal(done.ok, false);
    assert.equal(done.reason, 'not_automatic');
    assert.deepEqual(raced.log.popup, [{ on: false, by: null }, { forgot: true }]);
  } finally {
    raced.restore();
  }
});

test('creating a replacement stands the old one down through the same function', () => {
  const admin = code(SRC('src', 'routes', 'admin.js'));
  assert.ok(
    admin.includes("await promotions.standDown(previous.id, { by: req.opsUser && req.opsUser.id, keepPopup: true })"),
    'the create route writes an audience of its own again'
  );
  // Creating a replacement is not taking the website down: the popup has never
  // named a promotion, it shows whatever a new number is given.
  assert.ok(admin.includes('keepPopup: true'), admin.slice(admin.indexOf('standDown('), 200));
});

test('THE POPUP COMES DOWN BEFORE THE AUDIENCE MOVES, not after', () => {
  // Taking the popup off is safe on its own and can be done twice. The other
  // order strands app_settings.website_popup at true if the write fails - with
  // the ops switch no longer rendering, because it only renders for the
  // automatic promotion, which this one no longer is.
  const promos = code(SRC('src', 'core', 'promotions.js'));
  const at = promos.indexOf('async function standDown(');
  const body = promos.slice(at, promos.indexOf('\n}', at));

  const popup = body.indexOf('setWebsitePopup(false, by)');
  const moved = body.indexOf(".update({ audience: STOOD_DOWN");
  assert.ok(popup > 0 && moved > 0, body);
  assert.ok(popup < moved, 'the audience moves before the website comes down');
  assert.ok(body.indexOf('sitePopup.forget()') < moved, 'the cached offer outlives the change');
});

test('IT WRITES SPECIFIC, AND sms.js IS WHY IT IS NOT CODE', () => {
  // These two facts belong in one test: separately, either could be changed
  // without the other failing, and the pair is the whole reason for the choice.
  const promos = code(SRC('src', 'core', 'promotions.js'));
  const at = promos.indexOf('async function standDown(');
  const body = promos.slice(at, promos.indexOf('\n}', at));
  assert.ok(body.includes('audience: STOOD_DOWN'), body);
  assert.equal(promotions.STOOD_DOWN, 'SPECIFIC');

  // sms.js reads audience CODE as evidence that somebody scanned a door hanger.
  // A promotion stood down onto CODE would put "they scanned a card" in the
  // consent record of everybody who typed the code off an old text.
  const sms = code(SRC('src', 'routes', 'sms.js'));
  assert.ok(sms.includes("audience === 'CODE'"), 'the door-hanger test moved, so STOOD_DOWN can be reconsidered');
  assert.ok(/DOOR_HANGER/.test(sms), sms.slice(0, 0) || 'the consent source moved');
});

test('a first message with no promotion offers no discount, only the price', () => {
  // THE FUNCTION MOVED AND THE RULE DID NOT. This was introduction(), which
  // took the opening clause as its first argument; Lyn's locked rules made the
  // intro the same on every door, so the clause is built in and the function is
  // firstMessage(). What is being protected is unchanged and is the whole point
  // of this file: with no promotion attached, the first thing a stranger reads
  // names the price and promises nothing off it.
  //
  // AND IT NO LONGER NAMES THE PRICE, WHICH THIS TEST USED TO REQUIRE. Neil's
  // locked rules cut the first message to the intro and one short question, so
  // "$2.00 a pound" is not in it on any door and asserting it here would be
  // this file demanding the opposite of a decision he made. The price is still
  // written in exactly one place and still reaches the customer; it simply
  // arrives in the answer rather than in the greeting.
  //
  // WHAT THIS FILE IS FOR IS THE OTHER HALF, and it is unchanged: whatever the
  // first message says, with no promotion attached it must not promise money
  // off. That is the assertion that would fail the day somebody made the 50%
  // automatic again.
  const onboarding = require('../src/core/onboarding');
  const text = onboarding.firstMessage({ promo: null });
  assert.ok(!/% off/i.test(text), text);
  assert.ok(!/free|discount|CLEAN50/i.test(text), text);
});

// --- the screen says what the button does ----------------------------------------

test('THE CONSEQUENCE IS ON THE SCREEN BEFORE THE BUTTON IS PRESSED', () => {
  const page = SRC('src', 'web', 'prelaunch-page.js');
  const at = page.indexOf('function standDownCard(');
  assert.notEqual(at, -1, 'the button has no card');
  const card = page.slice(at, page.indexOf('\nfunction ', at + 10));

  assert.ok(/Everybody already holding it keeps it/.test(card), card);
  assert.ok(/still gets it/.test(card), 'it does not say the code keeps working');
  assert.ok(card.includes('/stand-down'), card);
  assert.ok(card.includes('if (!isAutomatic'), 'it offers to stand down something nobody is being given');

  // A code is a second way in whatever the audience says, so every promotion
  // page says so rather than leaving somebody to find out.
  assert.ok(page.includes('Anybody who texts <strong>${escapeHtml(promo.code)}</strong> can claim it too.'), 'the code is not named');

  // The popup switch can always be turned off, even once it is not automatic.
  const website = page.slice(page.indexOf('function websiteCard('), at);
  assert.ok(website.includes('Take the popup off the website'), 'a popup left on cannot be cleared');
});
