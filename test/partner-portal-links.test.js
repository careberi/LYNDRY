'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const partners = require('../src/core/partners');
const staff = require('../src/core/partner-staff');
const notify = require('../src/core/notify');
const { config } = require('../src/config');
const { partnerDetailBody } = require('../src/web/partners-page');
const SHOP = { id: '11111111-1111-4111-8111-111111111111', name: 'Example Laundry', type: 'LAUNDROMAT', status: 'ACTIVE', slug: 'example-laundry' };
const PERSON = { id: '22222222-2222-4222-8222-222222222222', partner_id: SHOP.id, name: 'Attendant', phone: '+12015550160', role: 'ATTENDANT', status: 'ACTIVE' };
const history = { rows: [], total: 0, flagged: 0, meanDrift: 0, heavier: 0, lighter: 0 };

test('concurrent missing-URL repair returns the saved address, not an unsaved candidate', async t => {
  const db = require('../src/db');
  let saved = null;
  t.mock.method(db, 'from', table => {
    assert.equal(table, 'partners');
    let updating = false;
    const query = {
      select() { return query; }, eq() { return query; }, neq() { return query; }, is() { return query; },
      update() { updating = true; saved = 'already-bookmarked'; return query; },
      limit: async () => ({ data: [] }),
      maybeSingle: async () => ({ data: updating ? null : { slug: saved } }),
      then(resolve) { return Promise.resolve({ data: null }).then(resolve); },
    };
    return query;
  });
  assert.equal(await partners.ensureSlug({ ...SHOP, slug: null }), 'already-bookmarked');
});

test('both partner layouts expose a full shareable URL and text only active staff actions', () => {
  for (const courierModel of [true, false]) {
    const html = partnerDetailBody({ partner: SHOP, history, courierModel, canManagePortal: true,
      staff: [PERSON, { ...PERSON, id: 'disabled-person', status: 'DISABLED' }] });
    const url = config.baseUrl + '/shop/example-laundry';
    assert.ok(html.includes('href="' + url + '"'), 'portal must use the public host, including from POS');
    assert.ok(html.includes('>' + url + '</a>'), 'the full address must be readable and shareable');
    assert.ok(html.includes('action="/ops/partners/' + SHOP.id + '/staff/' + PERSON.id + '/portal-link"'));
    assert.match(html, /Text portal link/);
    assert.doesNotMatch(html, /disabled-person\/portal-link/);
    assert.doesNotMatch(partnerDetailBody({ partner: SHOP, history, courierModel, staff: [PERSON] }), /Text portal link/);
  }
});

test('opening an imported shop repairs its missing address without sending a text', async t => {
  const links = require('../src/core/partner-portal-links');
  let creates = 0;
  t.mock.method(partners, 'ensureSlug', async p => { creates++; assert.equal(p.id, SHOP.id); return 'example-laundry'; });
  t.mock.method(notify, 'sendAndLog', async () => assert.fail('viewing must never send'));
  assert.equal((await links.prepare({ ...SHOP, slug: null })).slug, 'example-laundry');
  assert.equal((await links.prepare({ ...SHOP, slug: 'bookmarked-name' })).slug, 'bookmarked-name');
  assert.equal(creates, 1);
  assert.equal((await links.prepare({ ...SHOP, type: 'PROPERTY_MANAGER', slug: null })).slug, null);
});

test('a staff link goes only to the selected saved number with the shop URL, without granting access', async t => {
  const links = require('../src/core/partner-portal-links');
  t.mock.method(partners, 'find', async id => { assert.equal(id, SHOP.id); return SHOP; });
  t.mock.method(staff, 'list', async id => { assert.equal(id, SHOP.id); return [PERSON]; });
  const sent = [];
  t.mock.method(notify, 'sendAndLog', async (...args) => { sent.push(args); return { sent: true, simulated: false }; });
  const result = await links.send({ partnerId: SHOP.id, userId: PERSON.id, sentBy: 'admin', phone: '+12015550199', url: 'https://wrong.example' });
  assert.equal(result.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], PERSON.phone);
  assert.match(sent[0][1], /Example Laundry/);
  assert.ok(sent[0][1].includes(config.baseUrl + '/shop/example-laundry'));
  assert.match(sent[0][1], /sign in.*mobile number/i);
  assert.doesNotMatch(sent[0][1], /wrong\.example|\/ops\/|token=/);
  assert.equal(sent[0][2], null);
  assert.equal(sent[0][3].sentBy, 'admin');
});

test('wrong-shop or disabled staff, missing URLs and inactive shops send nothing', async t => {
  const links = require('../src/core/partner-portal-links');
  let shop = SHOP, people = [PERSON];
  t.mock.method(partners, 'find', async () => shop);
  t.mock.method(staff, 'list', async () => people);
  t.mock.method(partners, 'ensureSlug', async () => null);
  t.mock.method(notify, 'sendAndLog', async () => assert.fail('must not send'));
  const send = () => links.send({ partnerId: SHOP.id, userId: PERSON.id });
  people = [{ ...PERSON, partner_id: 'another-shop' }]; assert.equal((await send()).sent, false);
  people = [{ ...PERSON, status: 'DISABLED' }]; assert.equal((await send()).sent, false);
  people = []; assert.equal((await send()).sent, false);
  people = [PERSON]; shop = { ...SHOP, slug: null }; assert.equal((await send()).sent, false);
  shop = { ...SHOP, status: 'INACTIVE' }; assert.equal((await send()).sent, false);
  shop = { ...SHOP, type: 'PROPERTY_MANAGER' }; assert.equal((await send()).sent, false);
});

test('send outcomes preserve opt-out, duplicate, simulated and uncertain results', async t => {
  const links = require('../src/core/partner-portal-links');
  t.mock.method(partners, 'find', async () => SHOP);
  t.mock.method(staff, 'list', async () => [PERSON]);
  let outcome;
  t.mock.method(notify, 'sendAndLog', async () => outcome);
  for (outcome of [{ sent: false, refused: 'opted_out' }, { sent: false, refused: 'duplicate' }, { sent: true, simulated: true }, { sent: false, uncertain: true }]) {
    assert.deepEqual(await links.send({ partnerId: SHOP.id, userId: PERSON.id }), { ...outcome, phone: PERSON.phone });
  }
});

test('POS profile repairs and displays the link; guarded button sends to its saved staff member', async t => {
  const express = require('express');
  const db = require('../src/db');
  const auth = require('../src/core/admin-auth');
  const { router } = require('../src/routes/admin');
  const { posHost } = require('../src/web/pos-host');
  let user = { id: 'admin', name: 'Admin', role: 'ADMIN', status: 'ACTIVE', session_token: 'test-token' };
  t.mock.method(db, 'from', table => {
    assert.equal(table, 'ops_users');
    const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: user }) };
    return query;
  });
  t.mock.method(require('../src/core/issues'), 'openCount', async () => 0);
  t.mock.method(require('../src/core/settings'), 'takingOrders', async () => true);
  t.mock.method(partners, 'find', async () => ({ ...SHOP, slug: null }));
  t.mock.method(partners, 'ensureSlug', async () => 'example-laundry');
  t.mock.method(partners, 'weightHistory', async () => history);
  t.mock.method(partners, 'weighedFor', async () => null);
  t.mock.method(partners, 'hoursFor', async () => []);
  t.mock.method(partners, 'loadByPartner', async () => new Map());
  t.mock.method(staff, 'list', async () => [PERSON]);
  const sends = [];
  let outcome = { sent: true, simulated: false };
  t.mock.method(notify, 'sendAndLog', async (...args) => { sends.push(args); return outcome; });
  const app = express();
  app.use(posHost({ host: '127.0.0.1', publicOrigin: config.baseUrl }));
  app.use(express.urlencoded({ extended: false })); app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const profile = '/partners/' + SHOP.id;
  const action = profile + '/staff/' + PERSON.id + '/portal-link';
  let cookie;
  auth.setSessionCookie({ cookie(name, value) { cookie = name + '=' + value; } }, user.id, user.session_token);
  const request = (url, options = {}) => fetch(base + url, { redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, ...options });
  const page = await request(profile);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('href="' + config.baseUrl + '/shop/example-laundry"'));
  assert.ok(html.includes('action="' + action + '"'));
  assert.equal(sends.length, 0);
  const response = await request(action, { method: 'POST', body: new URLSearchParams({ phone: '+12015550199', userId: 'wrong-person' }) });
  assert.equal(response.status, 303);
  assert.match(decodeURIComponent(response.headers.get('location')), /Portal link sent to 201-555-0160/);
  assert.equal(sends.length, 1); assert.equal(sends[0][0], PERSON.phone);
  outcome = { sent: false, uncertain: true };
  const failed = await request(action, { method: 'POST' });
  assert.match(decodeURIComponent(failed.headers.get('location')), /Could not confirm/);
  outcome = { sent: true, simulated: true };
  const simulated = await request(action, { method: 'POST' });
  assert.match(decodeURIComponent(simulated.headers.get('location')), /Simulated only/);
  const count = sends.length;
  user = { ...user, role: 'DRIVER' };
  assert.equal((await request(action, { method: 'POST' })).status, 403);
  assert.equal((await request(action, { method: 'POST', headers: {} })).status, 302);
  assert.equal(sends.length, count);
});
