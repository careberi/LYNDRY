'use strict';

// ---------------------------------------------------------------------------
// AN ENDED PROMOTION STILL BELONGS TO THE PEOPLE HOLDING IT.
//
// The End button has always said "Anyone already holding it keeps it", and
// CLAUDE.md says the same. It was not true. heldBy() filtered on live(), which
// rejects anything not ACTIVE, so pressing End silently took the promotion off
// every holder while telling the person who pressed it the opposite.
//
// It had never fired only because nothing had ever been ended. On 10 September
// Neil asked to end the free first order - "the people who have it have it" -
// which would have stripped fifteen people of an offer they had been texted.
//
// THIS IS PINNED BECAUSE THE FAILURE IS SILENT AND ABOUT MONEY. Nothing throws.
// A customer is priced at full rate for an order they were told was free, and
// the first anybody hears of it is them.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const promotions = require('../src/core/promotions');
const onboarding = require('../src/core/onboarding');

const now = new Date('2026-09-10T15:00:00Z');
const past = '2026-09-01T00:00:00Z';
const future = '2026-10-01T00:00:00Z';

test('an ENDED promotion is still honoured for somebody who holds it', () => {
  assert.equal(promotions.honoured({ status: 'ENDED' }, now), true);
});

test('but an ENDED promotion is not handed to anybody new', () => {
  // The two questions are different and must stay different. live() is "can
  // this be granted"; honoured() is "does a promise already made still stand".
  assert.equal(promotions.live({ status: 'ENDED' }, now), false);
  assert.equal(promotions.live({ status: 'ACTIVE' }, now), true);
});

test('an ACTIVE promotion is honoured', () => {
  assert.equal(promotions.honoured({ status: 'ACTIVE' }, now), true);
});

test('a promotion that has not started yet is not honoured', () => {
  assert.equal(promotions.honoured({ status: 'ACTIVE', starts_at: future }, now), false);
});

test('ends_at still withdraws it, exactly as before', () => {
  // Deliberately unchanged. Nothing sets ends_at today, and whether a scheduled
  // end should also withdraw from holders is a different decision from End.
  assert.equal(promotions.honoured({ status: 'ACTIVE', ends_at: past }, now), false);
});

test('nothing at all is not honoured', () => {
  assert.equal(promotions.honoured(null, now), false);
  assert.equal(promotions.honoured(undefined, now), false);
});

test('a status the schema does not allow is not quietly honoured', () => {
  // promotions_status_check allows ACTIVE and ENDED and nothing else. If a
  // third value is ever added, it has to be decided here on purpose rather
  // than inherited by default.
  assert.equal(promotions.honoured({ status: 'PAUSED' }, now), false);
  assert.equal(promotions.honoured({ status: '' }, now), false);
});

test('the per-person expiry still applies to an honoured grant', () => {
  // Honouring an ended promotion does not make a grant immortal. A holder whose
  // own thirty days are up has lost it, whatever the promotion's status.
  assert.equal(promotions.expired({ expires_at: past }, now), true);
  assert.equal(promotions.expired({ expires_at: future }, now), false);
  assert.equal(promotions.expired({ expires_at: null }, now), false);
});

// ---------------------------------------------------------------------------
// THE EXPIRY SENTENCE on a claimed code.
// ---------------------------------------------------------------------------

test('a grant with an expiry says the day, on New Jersey time', () => {
  // 03:00 UTC on the 10th is still the 9th in New Jersey. A date worked out in
  // UTC would be a day early for anybody reading it in the evening.
  const note = onboarding.expiryNote({ expires_at: '2026-10-10T03:00:00Z' });
  assert.equal(note, ' It is good until Friday 9 Oct.');
});

test('a grant with no expiry says nothing about one', () => {
  // Never invent an end date for a promotion that has none.
  assert.equal(onboarding.expiryNote({ expires_at: null }), '');
  assert.equal(onboarding.expiryNote(null), '');
});

test('the expiry sentence is plain ASCII', () => {
  const note = onboarding.expiryNote({ expires_at: '2026-10-10T15:00:00Z' });
  const exotic = [...note].filter((c) => c.charCodeAt(0) > 127);
  assert.deepEqual(exotic, [], `non-GSM characters: ${JSON.stringify(exotic)}`);
});
