'use strict';

const promotions = require('./promotions');

// ---------------------------------------------------------------------------
// Claiming a promotion by texting a code.
//
// Neil is printing door hangers with a QR code. Scanning it opens the phone's
// messaging app with the message already typed - "Hi LYNDRY - promo D00R10" -
// and sending it is how somebody claims $10 off.
//
// CLAUDE.md says a promotion is an object attached to a person and not a code,
// and that rule is not being weakened here. What a code does on a door hanger
// is ATTRIBUTION, not redemption: there is no form, no landing page and no
// website visit, so a phone number arriving out of the blue is everything we
// ever see, and the code in that first message is the only way to know they
// came from a door in Ridgewood rather than from an advert. Once it lands the
// promotion attaches to the person like every other one and is never typed
// again - nothing to enter at booking, no link to click.
//
// THIS MODULE ONLY READS TEXT. It decides whether a message carries a code and
// which promotion that is. Granting it, and deciding it replaces the automatic
// one, is onboarding.startConversation()'s job - because that is where every
// other "somebody new is here" decision already lives.
// ---------------------------------------------------------------------------

// FIVE CHARACTERS, so a code can never be a word somebody happened to type.
// Every real message is scanned for one of these, so a three-character code
// would eventually match a real sentence and silently hand out money.
const MIN_LENGTH = 5;

// Words that are allowed to sit around a code without counting as the customer
// saying something. Everything the QR itself types is here, plus the greetings
// somebody adds by hand. If a message contains ONLY these and the code, there
// is nothing for the AI to answer and the canned introduction is right.
//
// WRITTEN IN ENGLISH AND NORMALISED HERE, never typed pre-mangled. The first
// version of this list had "FOR" in it, which normalise() turns into "F0R", so
// it could never match anything and nobody would have noticed - the failure is
// a message going to the AI that did not need to.
const FILLER = new Set(
  [
    'hi', 'hey', 'hello', 'hiya', 'yo', 'good', 'morning', 'afternoon', 'evening',
    'lyndry', 'promo', 'promotion', 'code', 'my', 'is', 'the', 'a', 'this', 'from',
    'door', 'hanger', 'please', 'thanks', 'thank', 'you', 'to', 'and', 'with', 'for',
    'me', 'us', 'it', 'here', 'have', 'got', 'want', 'i',
  ].map(normalise)
);

// A WORD MISSING FROM THAT LIST IS THE SAFE FAILURE, and it is worth being
// clear which way it fails. An unrecognised word means the message looks like
// it has something in it, so the AI answers instead of the canned introduction
// going out - and the AI introduces LYNDRY anyway. The expensive mistake is the
// other one: a list so generous that "can you come tomorrow" reads as filler
// and a real question is answered by a script. Add to it sparingly.

// ---------------------------------------------------------------------------
// The forgiving comparison. Neil's call: the code is printed on the hanger as
// well as encoded in the QR, so it has to survive being read off a card in a
// doorway and typed by hand.
//
// Upper case, and O read as 0. "D00R10" is unambiguous to a scanner and a
// coin-toss to a person - nobody looking at a printed card can tell a capital O
// from a zero, and half of them will type the wrong one. Both sides of every
// comparison go through this, and the unique index in migration 0078 normalises
// the same way, so two promotions cannot be coded DOOR10 and D00R10 at once.
// ---------------------------------------------------------------------------
function normalise(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[^A-Z0-9]/g, '');
}

// Every word in a message, normalised. Split on anything that is not a letter
// or a digit, so "promo:D00R10" and "promo D00R10." both give up the code.
function words(text) {
  return String(text || '')
    .split(/[^A-Za-z0-9]+/)
    .map(normalise)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Does this message carry a live code, and which promotion is it?
//
// Returns { promo, code } or null. Reads every live code-claimed promotion
// rather than guessing which word is the code: there are only ever a handful of
// them, and looking for "the word after promo" breaks the moment somebody texts
// the code on its own - which is exactly what a person retyping it does.
// ---------------------------------------------------------------------------
async function findIn(text) {
  const said = words(text).filter((w) => w.length >= MIN_LENGTH);
  if (!said.length) return null;

  const live = await promotions.claimableByCode();
  if (!live.length) return null;

  const wanted = new Set(said);

  for (const promo of live) {
    const code = normalise(promo.code);
    if (code.length >= MIN_LENGTH && wanted.has(code)) return { promo, code };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Did they send the code and nothing else?
//
// It decides who answers. A message that is only the QR's own text carries no
// question, so the canned introduction is right - the same reasoning as the
// website form, where there is nothing to reply TO. A message with anything
// real in it goes to the AI instead, because a script that ignores what
// somebody said is the robot behaviour this whole system exists to avoid.
//
// "Hi LYNDRY - promo D00R10"                    -> true, canned
// "promo D00R10 can you come tomorrow at 6?"    -> false, the AI answers
// ---------------------------------------------------------------------------
function isJustTheCode(text, code) {
  const rest = words(text).filter((w) => w !== normalise(code));
  return rest.every((w) => FILLER.has(w));
}

module.exports = { normalise, words, findIn, isJustTheCode, MIN_LENGTH, FILLER };
