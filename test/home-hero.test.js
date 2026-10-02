 'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../src/core/weight-based-pricing');

test('home receipt illustration uses a valid inclusive example and discloses its limits', () => {
  // Frozen illustrative inputs, not this visitor's quote or a live partner rate.
  const example = {
    category: 'SUBSCRIPTION', wholesaleCentsPerLb: 70,
    pickupCents: 699, returnCents: 699, minimumTotalCents: 3122,
    policy: { marginBps: { SUBSCRIPTION: 1000 }, processingBps: 290,
      processingFixedCents: 30, cardHold: { mode: 'FIXED', fixedCents: 2500 } },
  };
  const amount = model.total(example, 30);
  const home = fs.readFileSync(path.join(__dirname, '../public/pages/home.html'), 'utf8');
  const hero = home.slice(home.indexOf('<div class="hero-row">'), home.indexOf('<div class="fact-rail">'));
  assert.match(hero, new RegExp('\\$' + (amount / 100).toFixed(2).replace('.', '\\.')));
  assert.ok(hero.includes('About $' + (amount / 3000).toFixed(2) + ' / lb'));
  assert.match(hero, /Subscription example. Your price depends on your address, tier and bag weight/);
  assert.match(hero, /Next day return when available/);
  assert.doesNotMatch(hero, /Back tomorrow|>Free<|\$1\.80|\$33\.30/);
});
