'use strict';

// Which chase a thread earns, and when it stops. See assess() in
// src/core/followups.js - a pure function, so it is tested with made-up
// threads and no database is touched.
//
// followups.js requires the database module, which needs the .env to exist.
// Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');

const followups = require('../src/core/followups');

// A moment in the afternoon, New Jersey time, so that two hours later is
// still inside quiet hours and dueAt does not have to push anything to the
// next morning. 18:00 UTC is 2pm in September.
const T0 = Date.parse('2026-09-10T18:00:00Z');
const at = (hours) => new Date(T0 + hours * 3_600_000).toISOString();

const them = (hours, body = 'ok') => ({ direction: 'INBOUND', kind: null, body, created_at: at(hours) });
const ai = (hours, body = 'What is your address?') => ({ direction: 'OUTBOUND', kind: 'AI', body, created_at: at(hours) });
const chase = (hours) => ({ direction: 'OUTBOUND', kind: 'FOLLOW_UP', body: 'Still there?', created_at: at(hours) });
const system = (hours) => ({ direction: 'OUTBOUND', kind: 'SYSTEM', body: 'Order #1 booked', created_at: at(hours) });

// We spoke, they answered, we asked, silence.
const stalled = [ai(-1), them(-0.5), ai(0)];

test('mid-setup, nothing chased yet: the early nudge, two hours after the question', () => {
  const due = followups.assess(stalled, { midSetup: true });
  assert.equal(due.stage, 'early');
  assert.equal(due.hours, followups.EARLY_HOURS);
  assert.equal(due.lastAt, at(0));
  assert.equal(due.dueAt.getTime(), T0 + followups.EARLY_HOURS * 3_600_000);
});

test('not mid-setup, nothing chased yet: straight to the day-later chase', () => {
  const due = followups.assess(stalled, { midSetup: false });
  assert.equal(due.stage, 'final');
  assert.equal(due.hours, followups.AFTER_HOURS);
  assert.equal(due.dueAt.getTime(), T0 + followups.AFTER_HOURS * 3_600_000);
});

test('after the early nudge, the day-later chase is still to come', () => {
  const due = followups.assess([...stalled, chase(2)], { midSetup: true });
  assert.equal(due.stage, 'final');
  // Measured from the QUESTION, not from the nudge.
  assert.equal(due.lastAt, at(0));
});

test('after the day-later chase, nothing - it was the last one', () => {
  assert.equal(followups.assess([...stalled, chase(25)], { midSetup: true }), null);
  assert.equal(followups.assess([...stalled, chase(25)], { midSetup: false }), null);
});

test('two chases since they last spoke is the cap, whatever their timing', () => {
  assert.equal(followups.assess([...stalled, chase(2), chase(25)], { midSetup: true }), null);
  assert.equal(followups.assess([...stalled, chase(2), chase(3)], { midSetup: true }), null);
});

test('the customer speaking starts the count again', () => {
  const thread = [...stalled, chase(2), chase(25), them(30, 'sorry, 12 Main St'), ai(30.1, 'And the zip?')];
  const due = followups.assess(thread, { midSetup: true });
  assert.equal(due.stage, 'early');
  assert.equal(due.lastAt, at(30.1));
});

test('a tapback is looked straight past - a heart on our question is not an answer', () => {
  const thread = [...stalled, them(0.1, 'Loved “What is your address?”')];
  const due = followups.assess(thread, { midSetup: true });
  assert.equal(due.stage, 'early');
  assert.equal(due.lastAt, at(0));
});

test('a real reply from them means we are not waiting on them', () => {
  assert.equal(followups.assess([...stalled, them(0.2, '12 Main St')], { midSetup: true }), null);
});

test('a confirmation, a status text or a nudge button as the last word is not chased', () => {
  assert.equal(followups.assess([...stalled, system(0.1)], { midSetup: true }), null);
});

test('one exchange is not a conversation', () => {
  assert.equal(followups.assess([ai(0)], { midSetup: true }), null);
  assert.equal(followups.assess([them(-1), ai(0)], { midSetup: true }), null);
});

test('an empty thread earns nothing', () => {
  assert.equal(followups.assess([], { midSetup: true }), null);
  assert.equal(followups.assess(undefined), null);
});

test('midSetup decides which chase comes first, never whether', () => {
  for (const thread of [stalled, [...stalled, chase(2)], [...stalled, chase(25)], [...stalled, them(0.2)]]) {
    const a = followups.assess(thread, { midSetup: true });
    const b = followups.assess(thread, { midSetup: false });
    assert.equal(Boolean(a), Boolean(b));
  }
});
