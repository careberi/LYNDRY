'use strict';

// ---------------------------------------------------------------------------
// ONE CONSENT SENTENCE, WHEREVER SOMEBODY TYPES A PHONE NUMBER.
//
// A carrier reviewing this business opens two of our forms and expects to read
// the same sentence twice. CLAUDE.md has recorded that rule since the wording
// was written, and it has been kept by hand: five copies of it live in markup,
// because each one sits inside different surrounding HTML.
//
// They drifted once already - /sms-terms quoted wording no form had ever
// shown - and nothing caught it. This is what catches it now. site.smsConsent
// is the sentence; every copy below is held against it, whitespace flattened,
// because the only difference allowed between them is how the line wraps.
//
// Nothing here touches the database. If this fails, the fix is to correct the
// copy that moved, never to loosen the comparison.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { site } = require('../src/web/site');
const popup = require('../src/web/popup');

const root = path.join(__dirname, '..');

// How the sentence reads with the line breaks taken out, which is the only
// thing that legitimately differs between a page file and a template literal.
const flatten = (s) => String(s).replace(/\s+/g, ' ').trim();

const SENTENCE = flatten(site.smsConsent);

const COPIES = [
  ['the home page hero form', 'public/pages/home.html'],
  ['the /bergen advert form', 'public/pages/bergen.html'],
  ['the blockquote on /sms-terms', 'public/pages/sms-terms.html'],
  ['consentTick() on the account screens', 'src/routes/account.js'],
];

test('the sentence itself is the one the carriers were shown', () => {
  // Pinned literally, so a well-meaning rewrite of site.js fails here rather
  // than quietly changing every form at once.
  assert.equal(
    SENTENCE,
    'By checking this box you agree to receive text messages from lyndry at the ' +
      'number provided, including messages sent by autodialer. Consent is not a ' +
      'condition of purchase. Message and data rates may apply. Message frequency ' +
      'varies. Reply HELP for help, STOP to cancel.'
  );
});

for (const [what, file] of COPIES) {
  test(`${what} says exactly that`, () => {
    const text = flatten(fs.readFileSync(path.join(root, file), 'utf8'));
    assert.ok(
      text.includes(SENTENCE),
      `${file} no longer carries the consent sentence from site.smsConsent`
    );
  });
}

test('the offer popup renders it rather than carrying a copy', () => {
  const html = popup.markup({ headline: '50% off your first order', terms: [] });
  assert.ok(flatten(html).includes(SENTENCE));
});

test('the box is never ticked in advance, on any of them', () => {
  // A pre-ticked consent box is the fastest way to fail a carrier review, and
  // it is one attribute away on every one of these forms.
  const forms = [
    'public/pages/home.html',
    'public/pages/bergen.html',
    'src/routes/account.js',
  ].map((f) => fs.readFileSync(path.join(root, f), 'utf8'));

  forms.push(popup.markup({ headline: 'x', terms: [] }));

  for (const html of forms) {
    for (const tag of html.match(/<input[^>]*sms_consent[^>]*>/g) || []) {
      assert.ok(!/\bchecked\b/.test(tag), `a consent box ships pre-ticked: ${tag}`);
    }
  }
});
