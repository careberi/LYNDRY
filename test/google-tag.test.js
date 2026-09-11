'use strict';

// ---------------------------------------------------------------------------
// THE GOOGLE ADS TAG: WHAT IT SENDS, WHERE IT GOES, AND WHERE IT MUST NEVER GO.
//
// Google's tag reports the full address of every page it runs on to Google.
// The shared layout is also used by pages whose address IS a secret -
// /pay/<token>, /account/booked/<token>, /account/card/done/<token> - and by
// the order wizard, whose URL carries a customer's name and street address. So
// the tag is off unless a page asks for it.
//
// This regresses silently in the worst direction. Nothing breaks if somebody
// flips the layout's default to on; the site works perfectly and tokens and
// home addresses start arriving in an advertising account.
//
// Nothing here touches the database, the network or Google.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { googleTag, renderPage } = require('../src/web/layout');

const ON = {
  id: 'AW-18438272002',
  leadLabel: 'n0sjCK-C1_McEILohthE',
  leadValue: 1,
  currency: 'USD',
  enabled: true,
};
const CUSTOMER = '3f2c1b9a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

test('the tag is the snippet Google gave us, with our id', () => {
  const tag = googleTag({ ads: ON });
  assert.ok(tag.includes('https://www.googletagmanager.com/gtag/js?id=AW-18438272002'));
  assert.ok(tag.includes("gtag('config', 'AW-18438272002', lyPage);"));
});

test('a real save fires the lead with value, currency and its own transaction id', () => {
  const tag = googleTag({ ads: ON, conversionId: CUSTOMER });
  assert.ok(
    tag.includes(
      `gtag('event', 'conversion', {send_to: 'AW-18438272002/n0sjCK-C1_McEILohthE', value: 1, currency: 'USD', transaction_id: '${CUSTOMER}'});`
    ),
    tag
  );
});

test('a page with nothing saved fires no lead of its own', () => {
  // The tap listener mentions a conversion on every tagged page, so the thing
  // to look for is a transaction id - which only a real save carries.
  assert.ok(!googleTag({ ads: ON }).includes('transaction_id'));
});

test('an id that is not a UUID is not written into the script', () => {
  // It lands in a <script> verbatim. A cookie is not trusted into one on faith.
  ["x'}); alert(1); //", '1001', 'not-a-uuid', ''].forEach((id) => {
    const tag = googleTag({ ads: ON, conversionId: id });
    assert.ok(!tag.includes('transaction_id'), `accepted ${JSON.stringify(id)}`);
    assert.ok(!tag.includes('alert'), `injected ${JSON.stringify(id)}`);
  });
});

test('with no label, the tag still loads but counts nothing', () => {
  const tag = googleTag({ ads: { ...ON, leadLabel: '' }, conversionId: CUSTOMER });
  assert.ok(tag.includes("gtag('config'"), 'the base tag should still load');
  assert.ok(!tag.includes("'conversion'"), 'no conversion, and no tap listener, without a label');
});

test('switched off, it renders nothing at all', () => {
  // Production only. The dev server shares the production database, and a
  // laptop's test page loads must never count as ad traffic.
  assert.equal(googleTag({ ads: { ...ON, enabled: false }, conversionId: CUSTOMER }), '');
});

test('an id that is not shaped like one never reaches the page', () => {
  ["AW-1'); alert(1); //", 'G-ABC123', 'AW-', '', 'aw-18438272002'].forEach((id) => {
    assert.equal(googleTag({ ads: { ...ON, id } }), '', `accepted an id of ${JSON.stringify(id)}`);
  });
});

test('a label that could break out of the script is refused', () => {
  const tag = googleTag({
    ads: { ...ON, leadLabel: "x'}); alert(document.cookie); //" },
    conversionId: CUSTOMER,
  });
  assert.ok(!tag.includes('alert'), 'an injected label reached the page');
});

// ---------------------------------------------------------------------------
// THE LAYOUT'S DEFAULT. The part that protects the token pages.
// ---------------------------------------------------------------------------

test('the layout carries no tag unless the page asks for one', () => {
  // renderPage reads config.googleAds, which is off outside production, so this
  // proves the DEFAULT is off rather than only that production is off.
  const html = renderPage({ title: 'Pay', description: 'x', path: '/pay', body: '<p>token page</p>' });
  assert.ok(!html.includes('googletagmanager'), 'a page that did not ask got the tag');
});

// ---------------------------------------------------------------------------
// WHAT THE TAG ACTUALLY DOES, run for real rather than read.
//
// Executes the tag's own inline script against a fake browser and captures
// every gtag() call, plus the click listener it installs.
// ---------------------------------------------------------------------------

function run({ href = 'https://lyndry.com/', referrer = '', stripQuery = false, conversionId = null } = {}) {
  const tag = googleTag({ ads: ON, stripQuery, conversionId });
  const script = tag.split('<script>')[1].split('</script>')[0];

  const listeners = {};
  const fakeWindow = { dataLayer: [] };
  const fakeDocument = {
    referrer,
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
  };

  // eslint-disable-next-line no-new-func
  new Function('window', 'location', 'document', 'dataLayer', script)
    .call(null, fakeWindow, { href }, fakeDocument, fakeWindow.dataLayer);

  const calls = () => fakeWindow.dataLayer.map((a) => Array.from(a));
  return {
    calls,
    config: () => calls().find((a) => a[0] === 'config')[2],
    // Simulate a tap on a link with this href, and report whether the page's
    // own default behaviour was stopped.
    tap(linkHref) {
      let prevented = false;
      const link = { getAttribute: () => linkHref };
      listeners.click({
        target: { closest: (sel) => (/sms:|tel:/.test(linkHref) && sel.includes(linkHref.slice(0, 4)) ? link : null) },
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

test('a token in ?next= is not reported to Google', () => {
  const got = run({ href: 'https://lyndry.com/account/login?next=%2Faccount%2Fbooked%2FsecretToken123' }).config();
  assert.ok(!got.page_location.includes('secretToken123'), `leaked: ${got.page_location}`);
  assert.ok(!got.page_location.includes('next='), `next survived: ${got.page_location}`);
});

test("Google's ad-click id is kept, so a lead can still be credited to the ad", () => {
  const got = run({ href: 'https://lyndry.com/?gclid=Cj0KCQ_abc&utm_source=google&next=%2Fx' }).config();
  assert.ok(got.page_location.includes('gclid=Cj0KCQ_abc'), `gclid lost: ${got.page_location}`);
  assert.ok(got.page_location.includes('utm_source=google'), `utm lost: ${got.page_location}`);
  assert.ok(!got.page_location.includes('next='), `next survived: ${got.page_location}`);
});

test('the previous page is reported as its origin only', () => {
  const got = run({ href: 'https://lyndry.com/pricing', referrer: 'https://lyndry.com/account/card/done/secretToken456' }).config();
  assert.equal(got.page_referrer, 'https://lyndry.com/');
  assert.ok(!JSON.stringify(got).includes('secretToken456'), 'a referrer token leaked');
});

test('arriving from another site still says which site, and nothing more', () => {
  const got = run({ referrer: 'https://www.google.com/search?q=laundry+pickup' }).config();
  assert.equal(got.page_referrer, 'https://www.google.com/');
});

test("a customer's name and address in a query string never reach Google", () => {
  const got = run({
    href: 'https://lyndry.com/account/book?name=Jane+Doe&address_line1=12+Real+Street&postal_code=07031',
    stripQuery: true,
  }).config();
  assert.equal(got.page_location, 'https://lyndry.com/account/book');
});

test('the lead fires once, with its transaction id, when the page is told of a save', () => {
  const leads = run({ conversionId: CUSTOMER })
    .calls()
    .filter((a) => a[0] === 'event' && a[1] === 'conversion');
  assert.equal(leads.length, 1);
  assert.equal(leads[0][2].transaction_id, CUSTOMER);
  assert.equal(leads[0][2].value, 1);
  assert.equal(leads[0][2].currency, 'USD');
});

// ---------------------------------------------------------------------------
// TAPS ON TEXT AND CALL LINKS.
// ---------------------------------------------------------------------------

test('tapping a text link counts a lead and says it was a text', () => {
  const page = run();
  const prevented = page.tap('sms:+12015541877');
  const events = page.calls().filter((a) => a[0] === 'event');
  assert.ok(events.some((a) => a[1] === 'sms_click'), 'no sms_click');
  const lead = events.find((a) => a[1] === 'conversion');
  assert.ok(lead, 'no conversion on a text tap');
  assert.equal(lead[2].send_to, 'AW-18438272002/n0sjCK-C1_McEILohthE');
  assert.ok(!('transaction_id' in lead[2]), 'a tap has no record to name');
  assert.equal(prevented, false, 'the link must still open the messages app');
});

test('tapping a call link counts a lead and says it was a call', () => {
  const page = run();
  const prevented = page.tap('tel:+12017712933');
  const events = page.calls().filter((a) => a[0] === 'event');
  assert.ok(events.some((a) => a[1] === 'call_click'), 'no call_click');
  assert.ok(events.some((a) => a[1] === 'conversion'), 'no conversion on a call tap');
  assert.equal(prevented, false, 'the link must still dial');
});

test('tapping any other link counts nothing', () => {
  const page = run();
  page.tap('/pricing');
  assert.ok(!page.calls().some((a) => a[0] === 'event'), 'an ordinary link counted as a lead');
});
