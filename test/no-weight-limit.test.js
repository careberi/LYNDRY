'use strict';

// ---------------------------------------------------------------------------
// NOTHING STATES A MAXIMUM LOAD, BECAUSE THERE IS NOT ONE.
//
// 25 September. A customer asked "If I have 70lbs how much?" and Lyn answered
// that we take up to 50 lb per pickup and 70 lb would need splitting across two
// pickups. Neil: we can do more than that, never say it.
//
// ONE NUMBER IN config.js WAS BEING RECITED IN SIX PLACES. `maxOrderLb: 50`
// reached site.maxOrder, the {{MAX_ORDER}} token, four public pages, the FAQ's
// structured data, llms.txt and the AI's prompt - and NOTHING ENFORCED IT. It
// set an `overMaxOrder` flag that only the ops JSON API echoed and no screen
// ever read. So it did no work at all except get quoted at customers, and what
// it quoted was false.
//
// IT IS DELETED RATHER THAN RAISED. A bigger number would be the same bug
// waiting, because any figure sitting in config is one somebody will publish.
// This test is what stops it coming back: it asserts against the EXPORTED
// VALUES rather than the source, so the comments explaining the removal cannot
// satisfy their own assertions - the shape CLAUDE.md records twice.
//
// If a real ceiling ever exists it belongs to the van or the laundromat, both
// of which already carry capacities of their own.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { config } = require('../src/config');
const { site, tokens } = require('../src/web/site');

const PAGES = path.join(__dirname, '..', 'public', 'pages');

test('NO PRICING SETTING HOLDS A MAXIMUM LOAD', () => {
  // Asserted on the value, not the file, so the comment above `maxOrderLb` in
  // config.js cannot keep this green by containing the word.
  assert.ok(!('maxOrderLb' in config.pricing), 'config.pricing has a maximum order again');
});

test('AND NOTHING CAN RENDER ONE', () => {
  assert.ok(!('maxOrder' in site), 'site.maxOrder is back');
  assert.ok(!('MAX_ORDER' in tokens), 'the {{MAX_ORDER}} token is back');
});

test('NO PUBLIC PAGE CLAIMS A CEILING', () => {
  const guilty = [];

  for (const file of fs.readdirSync(PAGES).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PAGES, file), 'utf8');

    // A token that no longer resolves would render literally on a live page,
    // which is the other way this change could go wrong.
    if (html.includes('{{MAX_ORDER}}')) guilty.push(`${file}: renders {{MAX_ORDER}}`);

    // A weight presented as a ceiling, however it is worded.
    for (const [re, what] of [
      [/up to \d+\s?(lb|pound)/i, 'says "up to N lb"'],
      [/maximum of \d+\s?(lb|pound)/i, 'names a maximum weight'],
      [/we (take|accept) up to/i, 'says what the most we take is'],
    ]) {
      if (re.test(html)) guilty.push(`${file}: ${what}`);
    }
  }

  assert.deepEqual(guilty, [], 'a page is quoting a maximum load again');
});

test('AND THE PAGES THAT USED TO SAY IT NOW SAY THE OPPOSITE', () => {
  // Removing the sentence is not enough on its own: "how much fits in a bag" is
  // a question a reader actually has, and leaving it unanswered is how somebody
  // fills the gap with the old number. The two pages that carried the cap
  // answer it the true way instead.
  for (const file of ['faq.html', 'how-it-works.html']) {
    const html = fs.readFileSync(path.join(PAGES, file), 'utf8');
    // \s+ because the copy is wrapped: faq.html breaks the line between "no"
    // and "maximum", and a plain space would have failed on the formatting
    // rather than on the claim.
    assert.match(html, /no\s+maximum/i, `${file} no longer answers how much you can send`);
  }
});
