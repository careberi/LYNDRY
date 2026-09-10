'use strict';

// ---------------------------------------------------------------------------
// SOMEBODY TEXTED A THREAD THE AI IS SWITCHED OFF ON.
//
// Neil's ask: "when a customer texts with AI turned off in the chat, text me...
// and tells me that a customer with AI turned off in the chat has texted you."
//
// THE PAUSE IS THE FEATURE AND THIS IS ITS MISSING HALF. An admin takes a
// conversation over and the AI says nothing at all until they hand it back -
// not a holding line, not an apology - which is exactly right while somebody is
// watching, and is why the thread is badged and counted on the conversations
// list. All of that is PULL: it tells you if you go and look. This is the push,
// and without it a paused thread is a customer nobody is answering at all.
//
// IT NEVER LIFTS THE PAUSE. Only a person reverses that, which is the whole
// difference between the pause and the automatic hold in issues.js. This
// module reads, decides whether to page somebody, and stamps a column. It has
// no opinion about whether the AI should speak.
// ---------------------------------------------------------------------------

const db = require('../db');
const { config } = require('../config');
const issues = require('./issues');
const { sendAndLog } = require('./notify');

// WHO CAN ACTUALLY DO SOMETHING ABOUT IT: the people who can read the thread
// and write back. Not a driver, who holds neither and could not act on this if
// they wanted to. alertRecipients() adds SUPPORT_PHONE on top, which is how
// this reaches Neil whether or not he has an ops_users row.
const PERMISSION = 'messages.view';

// HOW LONG BEFORE THE SAME NUMBER CAN PAGE AGAIN.
//
// The number exists to stop one person having a conversation with themselves
// from generating a text per message. An hour is long enough that an afternoon
// of back-and-forth is one page, and short enough that somebody who writes in
// the morning and again after lunch is not silently dropped.
//
// It is a ceiling, not a timer: a person replying resets it regardless, below.
const QUIET_MINUTES = 60;

// ---------------------------------------------------------------------------
// Should this message page anybody?
//
// THREE QUESTIONS, AND ONLY THE FIRST IS STORED. When did we last page about
// this number, has a person written to them since, and how long ago was it.
// The second is read off the thread rather than kept, because `messages` is
// already the record of who said what - a second copy would be one more thing
// to go stale the first time somebody writes from a different screen.
//
// A PERSON REPLYING RESETS IT, and that is the half that matters. It means
// "handled, then they came back tomorrow" pages again, while "still typing at
// each other" does not. Without it the rule would be a plain hourly throttle
// and a customer answered at 2pm who writes again at 2:30 would be invisible.
// ---------------------------------------------------------------------------
async function shouldAlert(phone) {
  const { data: pause, error } = await db
    .from('ai_pauses')
    .select('alerted_at')
    .eq('phone', phone)
    .maybeSingle();

  // FAILS QUIET, unlike the pause check itself. isPaused() fails closed
  // because the cost of being wrong is the AI talking over somebody handling a
  // complaint. The cost of being wrong HERE is a text to an admin, and paging
  // somebody because the database hiccupped is how a page stops being read.
  if (error) {
    console.error(`Could not read the alert stamp for ${phone}: ${error.message}`);
    return false;
  }

  const last = pause && pause.alerted_at ? new Date(pause.alerted_at) : null;
  if (!last) return true;

  // Has a person written to them since we last said anything? sent_by is the
  // human who typed it, and is null for everything nobody typed - the AI's own
  // replies, status texts, booking confirmations. Only a colleague counts.
  const { data: replied } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'OUTBOUND')
    .not('sent_by', 'is', null)
    .gt('created_at', last.toISOString())
    .limit(1);

  if (replied && replied.length) return true;

  return Date.now() - last.getTime() > QUIET_MINUTES * 60 * 1000;
}

// ---------------------------------------------------------------------------
// The message.
//
// Written here in code, like every other unprompted text in this system: it
// goes out because of something that HAPPENED rather than as an answer, the
// words are readable before anything sends, and the length is knowable.
//
// WHAT AN ADMIN NEEDS IN THE ORDER THEY NEED IT: who, the fact that nothing
// has answered them, what they actually said, and the way in. The snippet is
// what turns this from an interruption into a decision - "are you coming
// today" and "thanks!" want very different response times, and without it
// every page costs a screen unlock to triage.
// ---------------------------------------------------------------------------
function compose({ customer, phone, said }) {
  const who = (customer && customer.name) || 'Somebody';
  const digits = String(phone || '').replace(/\D/g, '');

  // Trimmed to keep the whole thing near two segments. Newlines out, because a
  // customer's line break would otherwise split this message oddly on a phone.
  const quote = String(said || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);

  return (
    `${who} just texted and the AI is switched OFF on that thread, so nothing ` +
    `has answered them.${quote ? ` "${quote}"` : ''} ` +
    `${config.baseUrl}/ops/messages/${digits}`
  );
}

// ---------------------------------------------------------------------------
// Page whoever can pick it up.
//
// NEVER BREAKS THE THING IT IS WATCHING. Every failure is swallowed and
// logged: this is called from the SMS route on the way to saying nothing, and
// an exception here must not turn "the AI stayed quiet" into "the webhook
// threw". The customer's message is already logged by the caller either way.
// ---------------------------------------------------------------------------
async function customerTexted({ phone, customer, said }) {
  try {
    if (!(await shouldAlert(phone))) return { sent: [], skipped: 'already told them' };

    const numbers = await issues.alertRecipients(PERMISSION);

    if (!numbers.length) {
      // The same shape of failure the handoff page had on 5 September, when a
      // customer was told a manager would be in touch and the alert went to a
      // console.error. Worth saying loudly.
      console.error(
        `${phone} texted a paused thread and nobody could be told: ` +
          'no active team member has a phone and SUPPORT_PHONE is unset.'
      );
      return { sent: [], skipped: 'nobody to tell' };
    }

    const body = compose({ customer, phone, said });

    // Logged against nobody: customer_id is null because this is a message to
    // US about a customer, not a message to the customer. Logging it against
    // them would put it in their own thread on the ops screens, where it reads
    // as something they were sent.
    const sent = [];
    for (const to of numbers) {
      await sendAndLog(to, body, null);
      sent.push(to);
    }

    // STAMPED AFTER THE SEND, never before. A stamp written first would mark
    // the number as handled when the carrier was down, and nobody would ever
    // be told. Sent-but-unstamped is the safer failure: it costs one duplicate,
    // and only if this dies between the two lines.
    await db
      .from('ai_pauses')
      .update({ alerted_at: new Date().toISOString() })
      .eq('phone', phone);

    console.log(`PAUSED  ${phone} texted with the AI off, ${sent.length} told.`);
    return { sent };
  } catch (err) {
    console.error(`Could not page anybody about ${phone} texting a paused thread: ${err.message}`);
    return { sent: [], skipped: err.message };
  }
}

module.exports = { customerTexted, shouldAlert, compose, PERMISSION, QUIET_MINUTES };
