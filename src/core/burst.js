'use strict';

const { config } = require('../config');

// ---------------------------------------------------------------------------
// WAIT A MOMENT BEFORE ANSWERING, IN CASE THEY ARE STILL TYPING.
//
// Neil's ask. People do not text a business in one tidy paragraph. They send
// "hey", then "can you grab my laundry tomorrow", then "around 3" - three
// messages in fifteen seconds, one thought. Answering each one as it lands
// gives them three replies, and the first two are answers to half a sentence:
// "Hey! How can I help?" to somebody who was mid-question.
//
// So a reply waits. Every message that arrives RESTARTS the wait, and when it
// finally runs, the AI is handed everything they said as one message - which is
// what a person reading the thread would answer.
//
// WHAT IS NOT DELAYED, and must never be:
//
//   STOP, START, HELP  legally required, answered in code, immediately. A
//                      pending reply is CANCELLED when one of these arrives -
//                      otherwise an AI reply lands after somebody opted out.
//   Anything outbound  status texts, confirmations, the ops send box. This is
//                      only about the AI answering an inbound message.
//
// IT IS HELD IN MEMORY, and that is a real trade. A restart loses whatever is
// waiting, which on Railway means a deploy mid-conversation. Three things make
// that acceptable rather than reckless: the window is seconds, not minutes;
// their message is already written to `messages` before the timer starts, so
// nothing is lost except our reply, and the thread shows an inbound with no
// answer; and the shutdown handler flushes everything pending before the
// process exits. The alternative is a job queue, which CLAUDE.md rules out.
// ---------------------------------------------------------------------------

// phone -> { timer, messages, firstAt, run }
const pending = new Map();

const waitMs = () => Math.max(0, config.replies.burstSeconds) * 1000;
const capMs = () => Math.max(0, config.replies.burstMaxSeconds) * 1000;

// Run one burst now. Taken out of the map FIRST, so a message that arrives
// while the AI is thinking starts a fresh burst rather than being swallowed by
// one that has already fired.
async function fire(phone) {
  const held = pending.get(phone);
  if (!held) return;

  pending.delete(phone);
  clearTimeout(held.timer);

  const joined = held.messages.join('\n');

  if (held.messages.length > 1) {
    console.log(`BURST   ${phone}: answering ${held.messages.length} messages as one.`);
  }

  try {
    await held.run(joined);
  } catch (err) {
    console.error(`Failed to answer ${phone} after the wait: ${err.message}`);
  }
}

// Hold this message and (re)start the clock.
//
// `run` is replaced each time rather than kept from the first call, because a
// later one carries the fresher customer row - the first message from an
// unknown number is what creates it.
function collect(phone, text, run) {
  const wait = waitMs();

  // Switched off - answer straight away. Also what the tests run with, so the
  // rest of the system can be exercised without twenty seconds a message.
  if (!wait) return answerNow(phone, [text], run);

  const now = Date.now();
  const held = pending.get(phone);

  if (held) {
    clearTimeout(held.timer);
    held.messages.push(text);
    held.run = run;
  } else {
    pending.set(phone, { timer: null, messages: [text], firstAt: now, run });
  }

  const entry = pending.get(phone);

  // A CAP, so a reply cannot be put off for ever. Somebody texting every
  // fifteen seconds would otherwise reset the clock indefinitely and never be
  // answered at all, which is a worse failure than answering mid-thought.
  const waited = now - entry.firstAt;
  const remaining = Math.max(0, capMs() - waited);
  const delay = Math.min(wait, remaining);

  if (delay <= 0) {
    console.log(`BURST   ${phone}: held long enough, answering now.`);
    return fire(phone);
  }

  console.log(
    `BURST   ${phone}: waiting ${Math.round(delay / 1000)}s in case there is more.`
  );

  entry.timer = setTimeout(() => {
    fire(phone).catch((err) => console.error(`Burst for ${phone} failed: ${err.message}`));
  }, delay);

  // The timer must not hold the process open on its own.
  if (entry.timer.unref) entry.timer.unref();

  return Promise.resolve();
}

// The no-wait path. Kept separate so `collect` reads as one decision rather
// than two shapes of the same thing.
async function answerNow(phone, messages, run) {
  try {
    await run(messages.join('\n'));
  } catch (err) {
    console.error(`Failed to answer ${phone}: ${err.message}`);
  }
}

// Throw away whatever is waiting for this number, unanswered.
//
// STOP is the case this exists for: they asked us to stop between sending a
// question and us answering it, and the answer must not go out anyway.
function cancel(phone) {
  const held = pending.get(phone);
  if (!held) return false;

  clearTimeout(held.timer);
  pending.delete(phone);
  console.log(`BURST   ${phone}: ${held.messages.length} message(s) dropped, not answered.`);
  return true;
}

// Answer everything that is waiting, right now. Called on the way down, so a
// deploy does not leave somebody with no reply at all.
async function flushAll() {
  const phones = [...pending.keys()];
  if (!phones.length) return 0;

  console.log(`BURST   flushing ${phones.length} pending repl${phones.length === 1 ? 'y' : 'ies'}.`);
  await Promise.allSettled(phones.map((phone) => fire(phone)));
  return phones.length;
}

// For the tests, and for anything that wants to know what is in flight.
const waitingFor = (phone) => {
  const held = pending.get(phone);
  return held ? held.messages.length : 0;
};

module.exports = { collect, cancel, flushAll, waitingFor };
