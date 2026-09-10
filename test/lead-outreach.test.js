'use strict';

// ---------------------------------------------------------------------------
// WHAT COUNTS AS HAVING REACHED SOMEBODY.
//
// Neil, 10 September: "stop doing automated outreach... I need a call with
// these people." /ops/leads sorts the call list into three piles, and the pile
// a lead sits in is DERIVED from the attempts rather than stored - so the
// count in the header and the group the row appears in cannot disagree.
//
// This is exactly the kind of rule that regresses quietly. Nothing crashes if
// a voicemail starts counting as contact; the list just gets shorter and
// people stop being rung, which nobody would notice for a fortnight.
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const leadOutreach = require('../src/core/lead-outreach');
const leads = require('../src/core/leads');

const attempt = (method) => ({ method });

test('a lead nobody has touched is one to ring', () => {
  assert.equal(leadOutreach.stateOf([]), 'NEW');
  assert.equal(leadOutreach.stateOf(undefined), 'NEW');
  assert.equal(leadOutreach.stateOf(null), 'NEW');
});

test('a voicemail is an attempt, not contact', () => {
  // The distinction the whole screen turns on. Somebody who got voicemail has
  // heard nothing from us, so folding this into "reached" would quietly take
  // them off the list nobody ever calls back.
  assert.equal(leadOutreach.stateOf([attempt('VOICEMAIL')]), 'TRIED');
});

test('a number that did not pick up is an attempt, not contact', () => {
  assert.equal(leadOutreach.stateOf([attempt('NO_ANSWER')]), 'TRIED');
});

test('several failed attempts are still only TRIED', () => {
  const tried = [attempt('NO_ANSWER'), attempt('VOICEMAIL'), attempt('NO_ANSWER')];
  assert.equal(leadOutreach.stateOf(tried), 'TRIED');
});

test('actually speaking to them is REACHED', () => {
  assert.equal(leadOutreach.stateOf([attempt('CALL')]), 'REACHED');
});

test('texting them by hand is REACHED', () => {
  // A text a person chose to send is contact. The automatic advert message is
  // not, and never reaches this function - see the next test.
  assert.equal(leadOutreach.stateOf([attempt('TEXT')]), 'REACHED');
});

test('one success among failures is REACHED, whatever the order', () => {
  assert.equal(
    leadOutreach.stateOf([attempt('NO_ANSWER'), attempt('CALL'), attempt('VOICEMAIL')]),
    'REACHED'
  );
  assert.equal(
    leadOutreach.stateOf([attempt('CALL'), attempt('NO_ANSWER')]),
    'REACHED'
  );
});

test('an auto-texted lead is not reached, because nobody chose to send it', () => {
  // Seventeen leads were auto-texted before the decision to stop, and that is
  // exactly the outreach that was not working. It lives on facebook_leads
  // .texted_at and is deliberately NOT an attempt, so those people stay in the
  // list to ring rather than being hidden by a message nobody read.
  assert.equal(leadOutreach.stateOf([]), 'NEW');
});

test('only real methods are accepted', () => {
  ['CALL', 'VOICEMAIL', 'NO_ANSWER', 'TEXT'].forEach((m) => {
    assert.equal(leadOutreach.isMethod(m), true, `${m} should be a method`);
  });

  // The form posts UNDO through the same field, and it must never reach the
  // database as a method - the CHECK constraint would refuse it, but a 500 is
  // a worse answer than a sentence.
  ['UNDO', 'undo', 'call', '', null, undefined, 'EMAIL', 'CARRIER_PIGEON'].forEach((m) => {
    assert.equal(leadOutreach.isMethod(m), false, `${JSON.stringify(m)} should not be a method`);
  });
});

test('every method has a label a person can read', () => {
  Object.entries(leadOutreach.METHODS).forEach(([key, label]) => {
    assert.equal(typeof label, 'string');
    assert.ok(label.length > 3, `${key} needs a real label`);
    // The screen shows these in a sentence, so they must not be shouted
    // constants leaking through.
    assert.notEqual(label, key);
  });
});

test('SPOKE is a subset of the methods, so a typo cannot make a state unreachable', () => {
  // If SPOKE ever held a string that is not a method, stateOf() would silently
  // never return REACHED and the "Reached" group would sit empty for ever.
  leadOutreach.SPOKE.forEach((m) => {
    assert.equal(leadOutreach.isMethod(m), true, `SPOKE lists ${m}, which is not a method`);
  });
});

test('the held-for-a-person sentinel is exported, so the screen cannot retype it', () => {
  // /ops/leads compares skipped against this constant to tell "waiting for a
  // call" apart from "opted out". Two copies of the string is how those two
  // lists silently become one.
  assert.equal(typeof leads.HELD_FOR_A_PERSON, 'string');
  assert.ok(leads.HELD_FOR_A_PERSON.length > 0);
});
