'use strict';

// ---------------------------------------------------------------------------
// THE GOOGLE ADS TAG: WHERE IT GOES, AND WHERE IT MUST NEVER GO.
//
// Google's tag reports the full address of every page it runs on to Google.
// The shared layout is also used by pages whose address IS a secret -
// /pay/<token>, /account/booked/<token>, /account/card/done/<token> - and by
// some of the ops screens. So the tag is off unless a page asks for it.
//
// This regresses silently in the worst direction. Nothing breaks if somebody
// flips the layout's default to on; the site works perfectly and payment
// tokens start arriving in an advertising account.
//
// Nothing here touches the database, the network or Google.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { googleTag, renderPage } = require('../src/web/layout');

const ON = { id: 'AW-18438272002', leadLabel: 'AbC-d_123', enabled: true };

test('the tag is the snippet Google gave us, with our id', () => {
  const tag = googleTag({ ads: ON });
  assert.ok(tag.includes('https://www.googletagmanager.com/gtag/js?id=AW-18438272002'));
  assert.ok(tag.includes("gtag('config', 'AW-18438272002', lyPage);"));
});

test('a lead conversion fires with the label from the event snippet', () => {
  const tag = googleTag({ ads: ON, conversion: 'lead' });
  assert.ok(tag.includes("gtag('event', 'conversion', {'send_to': 'AW-18438272002/AbC-d_123'});"));
});

test('a page that is not a conversion page fires no conversion', () => {
  assert.ok(!googleTag({ ads: ON }).includes("'conversion'"));
});

test('with no label, the tag still loads but reports no conversion', () => {
  // The safe way to be missing the label: visits are measured and nothing is
  // counted as a lead, rather than a conversion firing with a malformed id.
  const tag = googleTag({ ads: { ...ON, leadLabel: '' }, conversion: 'lead' });
  assert.ok(tag.includes("gtag('config'"), 'the base tag should still load');
  assert.ok(!tag.includes("'conversion'"), 'no conversion without a label');
});

test('switched off, it renders nothing at all', () => {
  // Production only. The dev server shares the production database, and a
  // laptop's test page loads must never count as ad traffic.
  assert.equal(googleTag({ ads: { ...ON, enabled: false }, conversion: 'lead' }), '');
});

test('an id that is not shaped like one never reaches the page', () => {
  // It is written into a <script> verbatim, so an environment variable is not
  // trusted into one on faith.
  ["AW-1'); alert(1); //", 'G-ABC123', 'AW-', '', 'aw-18438272002'].forEach((id) => {
    assert.equal(googleTag({ ads: { ...ON, id } }), '', `accepted an id of ${JSON.stringify(id)}`);
  });
});

test('a label that could break out of the script is refused', () => {
  const tag = googleTag({
    ads: { ...ON, leadLabel: "x'}); alert(document.cookie); //" },
    conversion: 'lead',
  });
  assert.ok(!tag.includes('alert'), 'an injected label reached the page');
  assert.ok(!tag.includes("'conversion'"), 'a refused label should fire no conversion');
});

// ---------------------------------------------------------------------------
// THE LAYOUT'S DEFAULT. The part that protects the token pages.
// ---------------------------------------------------------------------------

test('the layout carries no tag unless the page asks for one', () => {
  // renderPage reads config.googleAds, which is off outside production, so this
  // proves the DEFAULT is off rather than only that production is off: a page
  // that passes nothing gets nothing, in any environment.
  const html = renderPage({ title: 'Pay', description: 'x', path: '/pay', body: '<p>token page</p>' });
  assert.ok(!html.includes('googletagmanager'), 'a page that did not ask got the tag');
});

// ---------------------------------------------------------------------------
// WHAT THE TAG ACTUALLY HANDS TO GOOGLE, run for real rather than read.
//
// Both leaks below were found by loading pages, not by reading code, so this
// executes the tag's own inline script against a fake browser and captures the
// exact object passed to gtag('config').
// ---------------------------------------------------------------------------

function reported({ href, referrer, stripQuery = false }) {
  const tag = googleTag({ ads: ON, stripQuery });
  const script = tag.split('<script>')[1].split('</script>')[0];

  const fakeWindow = { dataLayer: [] };
  // eslint-disable-next-line no-new-func
  new Function('window', 'location', 'document', 'dataLayer', script)
    .call(null, fakeWindow, { href }, { referrer }, fakeWindow.dataLayer);
  // gtag pushes its arguments onto dataLayer; find the config call.
  const config = fakeWindow.dataLayer.map((a) => Array.from(a)).find((a) => a[0] === 'config');
  return config[2];
}

test('a token in ?next= is not reported to Google', () => {
  // The real case: a signed-out customer opening their booking link is sent to
  // the login page with the token riding in `next`.
  const got = reported({
    href: 'https://lyndry.com/account/login?next=%2Faccount%2Fbooked%2FsecretToken123',
    referrer: '',
  });
  assert.ok(!got.page_location.includes('secretToken123'), `leaked: ${got.page_location}`);
  assert.ok(!got.page_location.includes('next='), `next survived: ${got.page_location}`);
});

test("Google's ad-click id is kept, so a lead can still be credited to the ad", () => {
  // Stripping the whole query string would close the leak and silently make
  // every conversion unattributable. Only `next` may go.
  const got = reported({
    href: 'https://lyndry.com/?gclid=Cj0KCQ_abc&utm_source=google&next=%2Faccount%2Fbooked%2Fx',
    referrer: '',
  });
  assert.ok(got.page_location.includes('gclid=Cj0KCQ_abc'), `gclid lost: ${got.page_location}`);
  assert.ok(got.page_location.includes('utm_source=google'), `utm lost: ${got.page_location}`);
  assert.ok(!got.page_location.includes('next='), `next survived: ${got.page_location}`);
});

test('the previous page is reported as its origin only', () => {
  // Referrer-Policy sends the full address on a same-site click, so a customer
  // leaving a token page for Pricing would otherwise carry the token here.
  const got = reported({
    href: 'https://lyndry.com/pricing',
    referrer: 'https://lyndry.com/account/card/done/secretToken456',
  });
  assert.equal(got.page_referrer, 'https://lyndry.com/');
  assert.ok(!JSON.stringify(got).includes('secretToken456'), 'a referrer token leaked');
});

test('arriving from another site still says which site, and nothing more', () => {
  const got = reported({ href: 'https://lyndry.com/', referrer: 'https://www.google.com/search?q=laundry+pickup' });
  assert.equal(got.page_referrer, 'https://www.google.com/');
});

test("a customer's name and address in the order wizard's URL never reach Google", () => {
  // /account/book reads the wizard's answers out of its query string. The one
  // render of it that carries the tag uses stripQuery, and this is why: the
  // next-only redaction the marketing pages use would let all of this through.
  const got = reported({
    href: 'https://lyndry.com/account/book?name=Jane+Doe&address_line1=12+Real+Street&postal_code=07031&next=%2Fx',
    referrer: '',
    stripQuery: true,
  });
  assert.equal(got.page_location, 'https://lyndry.com/account/book');
  ['Jane', 'Real', '07031'].forEach((bit) =>
    assert.ok(!got.page_location.includes(bit), `leaked "${bit}": ${got.page_location}`)
  );
});
