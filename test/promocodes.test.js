'use strict';

// Claiming a promotion by texting a code off a door hanger.
// See src/core/promocodes.js.
//
// Run with `npm test`. Node's own test runner, no dependency.
//
// findIn() is not tested here because it reads the promotions table. Everything
// that decides whether a door hanger works is in these two pure functions.

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalise, isJustTheCode, MIN_LENGTH } = require('../src/core/promocodes');

// The message the QR code types for them, character for character.
const SCANNED = 'Hi LYNDRY - promo D00R10';

test('the scanned message matches the printed code', () => {
  assert.equal(normalise('D00R10'), 'D00R10');
  assert.equal(isJustTheCode(SCANNED, 'D00R10'), true);
});

test('O and 0 are the same character, because nobody can tell them apart on a card', () => {
  // The whole reason the code is printed beside the QR is that it works when
  // the camera does not - and half the people typing D00R10 will type letters.
  for (const typed of ['DOOR10', 'D00R10', 'DO0R10', 'D0OR10']) {
    assert.equal(normalise(typed), 'D00R10', typed);
  }
});

test('case, spaces and punctuation do not matter', () => {
  for (const typed of ['door10', 'Door10', ' DOOR 10 ', 'door-10', 'door.10']) {
    assert.equal(normalise(typed), 'D00R10', typed);
  }
});

test('a message that is only the code and filler gets the canned introduction', () => {
  const canned = [
    SCANNED,
    'D00R10',
    'door10',
    'Hi, my promo code is DOOR10',
    'hey lyndry promo door10 please',
    'Hello - code D00R10, thanks',
  ];

  for (const text of canned) {
    assert.equal(isJustTheCode(text, 'D00R10'), true, text);
  }
});

test('a message with a real question in it goes to the AI instead', () => {
  const answered = [
    'promo D00R10 can you come tomorrow at 6?',
    'Hi LYNDRY - promo D00R10. Do you do dry cleaning?',
    'door10 how much is it per pound',
    'D00R10 I am in Ridgewood, do you come here',
  ];

  for (const text of answered) {
    assert.equal(isJustTheCode(text, 'D00R10'), false, text);
  }
});

test('"for" is filler, which it was not when the list was typed pre-normalised', () => {
  // normalise() turns FOR into F0R, so a filler list written in shouty
  // pre-mangled form silently loses every word containing an O. The list is
  // written in English and normalised at construction precisely so this holds.
  assert.equal(isJustTheCode('promo door10 for me please', 'D00R10'), true);
  assert.equal(isJustTheCode('good morning, code door10', 'D00R10'), true);
  assert.equal(isJustTheCode('door10 from the door hanger, thank you', 'D00R10'), true);
});

test('a code has to be long enough that it cannot be an ordinary word', () => {
  // Every inbound message is scanned for a code, so a short one would
  // eventually match a real sentence and hand out money on its own.
  assert.ok(MIN_LENGTH >= 5);
});

test('normalise copes with nothing at all', () => {
  assert.equal(normalise(null), '');
  assert.equal(normalise(undefined), '');
  assert.equal(normalise(''), '');
  assert.equal(isJustTheCode('', 'D00R10'), true);
});
