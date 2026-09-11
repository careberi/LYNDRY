'use strict';

// ---------------------------------------------------------------------------
// GOOGLE'S CLICK IDS AND THE ONE-SHOT LEAD MARKER.
//
// A gclid arrives in a URL anybody can type, and goes into a cookie header and
// a database row. The lead marker goes into a <script>. Both are pinned here
// because the failure is quiet: a malformed value is not an error anybody sees.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const ads = require('../src/core/ad-attribution');

const UUID = '3f2c1b9a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

// A response and request just rich enough for the cookie helpers.
function fakeRes() {
  const set = {};
  const cleared = [];
  return {
    set,
    cleared,
    cookie: (name, value, opts) => {
      set[name] = { value, opts };
    },
    clearCookie: (name, opts) => cleared.push({ name, opts }),
  };
}
const fakeReq = (cookies, query = {}, method = 'GET') => ({
  method,
  query,
  headers: {
    cookie: Object.entries(cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; '),
  },
});

test('real Google click ids are kept', () => {
  assert.deepEqual(ads.clickIdsFrom({ gclid: 'Cj0KCQjw_abc-123' }), { gclid: 'Cj0KCQjw_abc-123' });
  assert.deepEqual(ads.clickIdsFrom({ gbraid: '0AAAAA_x', wbraid: 'CkAb-9' }), {
    gbraid: '0AAAAA_x',
    wbraid: 'CkAb-9',
  });
});

test('anything not shaped like a click id is dropped, not stored', () => {
  // It would otherwise go into a Set-Cookie header and a customers row.
  const bad = ads.clickIdsFrom({
    gclid: "x'; DROP TABLE customers; --",
    gbraid: '<script>',
    wbraid: 'a'.repeat(500),
  });
  assert.deepEqual(bad, {});
});

test('landing with a gclid sets a 90-day first-party cookie', () => {
  const res = fakeRes();
  let nexted = false;
  ads.captureAdClick(fakeReq({}, { gclid: 'TEST123' }), res, () => {
    nexted = true;
  });
  assert.ok(nexted, 'the middleware must always carry on');
  const c = res.set[ads.CLICK_COOKIE];
  assert.ok(c, 'no cookie was set');
  assert.deepEqual(JSON.parse(c.value), { gclid: 'TEST123' });
  assert.equal(c.opts.maxAge, 90 * 24 * 60 * 60 * 1000);
  assert.equal(c.opts.httpOnly, true);
  assert.equal(c.opts.path, '/');
});

test('a page with no click id in its URL sets nothing', () => {
  const res = fakeRes();
  ads.captureAdClick(fakeReq({}, { utm_source: 'google' }), res, () => {});
  assert.deepEqual(res.set, {});
});

test('a POST is never treated as a landing', () => {
  const res = fakeRes();
  ads.captureAdClick(fakeReq({}, { gclid: 'TEST123' }, 'POST'), res, () => {});
  assert.deepEqual(res.set, {});
});

test('the click cookie reads back, and a tampered one reads as nothing', () => {
  assert.deepEqual(
    ads.readAdClick(fakeReq({ [ads.CLICK_COOKIE]: JSON.stringify({ gclid: 'TEST123' }) })),
    { gclid: 'TEST123' }
  );
  assert.deepEqual(ads.readAdClick(fakeReq({ [ads.CLICK_COOKIE]: '{not json' })), {});
  assert.deepEqual(
    ads.readAdClick(fakeReq({ [ads.CLICK_COOKIE]: JSON.stringify({ gclid: '<x>' }) })),
    {}
  );
  assert.deepEqual(ads.readAdClick(fakeReq({})), {});
});

test('the lead marker is only set for a real UUID', () => {
  const res = fakeRes();
  ads.markLead(res, "1'); alert(1); //", '/start/sent');
  assert.deepEqual(res.set, {}, 'a non-UUID was marked');

  ads.markLead(res, UUID, '/start/sent');
  assert.equal(res.set[ads.LEAD_COOKIE].value, UUID);
  assert.equal(res.set[ads.LEAD_COOKIE].opts.path, '/start/sent');
  assert.equal(res.set[ads.LEAD_COOKIE].opts.httpOnly, true, 'the page must not be able to read it');
});

test('taking the lead returns its id once and clears it', () => {
  const res = fakeRes();
  assert.equal(ads.takeLead(fakeReq({ [ads.LEAD_COOKIE]: UUID }), res, '/start/sent'), UUID);
  assert.deepEqual(res.cleared, [{ name: ads.LEAD_COOKIE, opts: { path: '/start/sent' } }]);
});

test('no marker, no lead - and a forged one is refused', () => {
  assert.equal(ads.takeLead(fakeReq({}), fakeRes(), '/start/sent'), null);
  assert.equal(ads.takeLead(fakeReq({ [ads.LEAD_COOKIE]: "x'}); alert(1)" }), fakeRes(), '/start/sent'), null);
});
