'use strict';

// The old global limit remains removed for legacy orders. Neil's 20261001
// instruction introduces a real, enforced 50 lb limit for new weight-based quotes.
// Public explanations now name that scope; unresolved legacy tokens must not return.

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

test('public pages never render the removed global maximum token', () => {
  for (const file of fs.readdirSync(PAGES).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(PAGES, file), 'utf8');
    assert.ok(!html.includes('{{MAX_ORDER}}'), file);
  }
});

test('how it works explains the new quote limit instead of promising unlimited loads', () => {
  const html = fs.readFileSync(path.join(PAGES, 'how-it-works.html'), 'utf8');
  assert.match(html, /up to 50 lb/i);
  assert.doesNotMatch(html, /no\s+maximum/i);
  assert.match(html, /minimum/i);
});
