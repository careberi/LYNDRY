'use strict';

// A tapback is not a message. See src/core/reactions.js.
//
// Run with `npm test`. Node's own test runner, no dependency.

const test = require('node:test');
const assert = require('node:assert/strict');

const { isReaction } = require('../src/core/reactions');

test('the six Apple tapbacks are reactions, curly or straight quotes', () => {
  for (const verb of ['Liked', 'Loved', 'Disliked', 'Laughed at', 'Emphasized', 'Questioned']) {
    assert.equal(isReaction(`${verb} “Sounds good, see you Tuesday”`), true, verb);
    assert.equal(isReaction(`${verb} "Sounds good, see you Tuesday"`), true, `${verb} straight`);
  }
});

test('the two real ones from the first week', () => {
  assert.equal(
    isReaction('Liked “Hey, it\'s LYNDRY! We pick your laundry up, wash it, fold it and have it back to you the next'),
    true
  );
  assert.equal(
    isReaction('Loved “Sounds good, Vered. Whenever you\'re ready, just send us a text and we\'ll take it from there.”'),
    true
  );
});

test('taking a tapback back is a reaction too', () => {
  assert.equal(isReaction('Removed a heart from “Sounds good”'), true);
  assert.equal(isReaction('Removed a like from "ok"'), true);
});

test('ordinary messages that happen to start with the same words are not', () => {
  assert.equal(isReaction('Liked it, thanks - see you Tuesday'), false);
  assert.equal(isReaction('Loved the service last time'), false);
  assert.equal(isReaction('Go to "the door"'), false);
  assert.equal(isReaction('Questioned whether you do comforters?'), false);
});

test('blank and missing are not reactions - they have their own handling', () => {
  assert.equal(isReaction(''), false);
  assert.equal(isReaction(null), false);
  assert.equal(isReaction(undefined), false);
});
