'use strict';

// ---------------------------------------------------------------------------
// CLEARING THE "AI IS SWITCHED OFF" BANNER.
//
// Clearing hides the warning until there is something new to warn about. The
// failure worth pinning is the quiet one: a cleared thread that never comes
// back when the customer writes again is a customer nobody is answering, with
// nothing on the screen to say so.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { stillInBanner } = require('../src/core/ai-pause');

const PAUSED = '2026-09-07T16:35:00Z';
const THEY_TEXTED = '2026-09-07T16:46:00Z';
const CLEARED = '2026-09-11T13:30:00Z';

test('never cleared, it is in the banner', () => {
  assert.equal(stillInBanner({ pausedAt: PAUSED, clearedAt: null, lastInboundAt: THEY_TEXTED }), true);
});

test('cleared after everything they said, it is gone', () => {
  assert.equal(stillInBanner({ pausedAt: PAUSED, clearedAt: CLEARED, lastInboundAt: THEY_TEXTED }), false);
});

test('cleared, and a thread they never texted stays gone', () => {
  assert.equal(stillInBanner({ pausedAt: PAUSED, clearedAt: CLEARED, lastInboundAt: null }), false);
});

test('they text again after it was cleared, and it comes back', () => {
  assert.equal(
    stillInBanner({ pausedAt: PAUSED, clearedAt: CLEARED, lastInboundAt: '2026-09-11T14:00:00Z' }),
    true
  );
});

test('the AI switched off again after it was cleared, and it comes back', () => {
  assert.equal(
    stillInBanner({ pausedAt: '2026-09-12T09:00:00Z', clearedAt: CLEARED, lastInboundAt: THEY_TEXTED }),
    true
  );
});
