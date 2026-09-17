'use strict';

const db = require('../db');

// ---------------------------------------------------------------------------
// LYN: WHO THE ASSISTANT SAYS SHE IS.
//
// Neil's decision lock, 16 September. Lyn is NOT a new AI. She is the assistant
// that has been answering this thread all along, now given a customer-facing
// name and told to disclose what she is. No second model, no second prompt, no
// parallel conversation engine, and nothing in how orders are taken changes.
// This file holds four sentences and answers one question: does Lyn owe the
// customer an introduction before her next message?
//
// IT REVERSES A RULE THAT WAS LOCKED UNTIL TODAY. The prompt read "Never say
// you are an AI, an assistant, or a bot", and CLAUDE.md said the same in as
// many words. That was written to stop replies reading like a phone tree. Neil
// has taken the opposite view on disclosure specifically: she may never present
// herself as a person, and the customer is told plainly what she is. The rest
// of the voice - short, no emoji, no menus, never "reply 1 for" - is untouched.
//
// NOTHING HERE IS STORED. Whether Lyn owes an introduction is read off the
// thread and the pause row every time, the same doctrine as the nudge gaps and
// the partner load. A column saying "introduced: true" would go stale the first
// time somebody edited a thread by hand, and there is nothing it could answer
// that the messages cannot.
// ---------------------------------------------------------------------------

const NAME = 'Lyn';

// THE WORDS, and they are Neil's own, chosen 16 September over the
// alternatives put to him.
//
// "automated assistant" rather than "AI assistant": plainer to somebody with a
// bag of washing, and it does not invite a conversation about the technology
// instead of the laundry.
const INTRODUCTION = `Hi, I'm ${NAME}, LYNDRY's automated assistant.`;

// Said once, on Lyn's first reply after a person has handed the thread back.
// Short on purpose - it is a prefix to a real answer, not a message of its own.
const COMEBACK = `Hi, it's ${NAME} again.`;

// NO DASHES, ANYWHERE IN HERE. Neil's own draft of this line read "One second -
// let me get a manager", and a dash is the one piece of punctuation this system
// refuses: an em dash forces the whole text out of the GSM alphabet, which cuts
// a segment from 160 characters to 70 and bills accordingly.
const ESCALATION = 'One second, let me get a manager.';

// WHEN A THREAD COUNTS AS A NEW ONE. There is no thread object - a phone number
// has one continuous log - so "a genuinely new conversation later" has to be a
// gap. Two weeks of silence is somebody coming back rather than continuing, and
// being told once more who they are talking to costs a clause.
const NEW_THREAD_DAYS = 14;

// Has Lyn ever told THIS customer what she is?
//
// Matched on the sentence rather than on a flag, which reads as crude and is
// the honest test: the question is whether the words ever reached their phone.
// It also gets Neil's hardest edge case right for free - a thread that predates
// all of this has no introduction in it, so the next AI message carries one.
const SAID_IT = `I'm ${NAME},`;

async function everIntroduced(customerId) {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('customer_id', customerId)
    .eq('direction', 'OUTBOUND')
    .ilike('body', `%${SAID_IT}%`)
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

// The last thing anybody said on this thread, either direction.
async function lastSpokeAt(customerId) {
  const { data, error } = await db
    .from('messages')
    .select('created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? new Date(data.created_at) : null;
}

// Is there an AI-authored message since the moment Lyn was switched back on?
//
// kind = 'AI' is what marks one. Null is every message written before that
// column existed and everything nobody typed, so it is deliberately not counted
// - see the note on the comeback in opener() below.
async function aiSpokeSince(customerId, since) {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('customer_id', customerId)
    .eq('direction', 'OUTBOUND')
    .eq('kind', 'AI')
    .gt('created_at', since)
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

// WHAT LYN PUTS IN FRONT OF HER NEXT MESSAGE, or nothing at all.
//
// Three answers, in this order, and the order is the point:
//
//   INTRODUCTION  she has never said what she is on this thread, or the thread
//                 has been silent long enough to be a new conversation.
//                 DISCLOSURE WINS over the comeback: somebody who does not know
//                 what they are talking to needs telling more than somebody who
//                 knows and has been away
//   COMEBACK      a person took the thread over, somebody switched Lyn back on,
//                 and she has not spoken since. Said once
//   ''            the ordinary case, which is almost every message. Announcing
//                 herself every time is the exact thing Neil ruled out
//
// FAILS TO SILENCE, not to chatter: if the lookup breaks we return nothing
// rather than risk introducing her on every message in a live conversation.
// The cost is a missed disclosure on one message; the alternative reads as a
// machine stuck in a loop.
async function opener(customer) {
  if (!customer || !customer.id) return '';

  try {
    if (!(await everIntroduced(customer.id))) return INTRODUCTION;

    const spokeAt = await lastSpokeAt(customer.id);
    if (spokeAt && Date.now() - spokeAt.getTime() > NEW_THREAD_DAYS * 86_400_000) {
      return INTRODUCTION;
    }

    // Lazy, because ai-pause.js already reaches issues.js and a top-level
    // require here would close a loop.
    const aiPause = require('./ai-pause');
    const state = await aiPause.stateFor(customer.phone);

    // Only a thread that was actually switched back on owes a comeback, and
    // only until she has used it.
    if (state && !state.paused && state.resumed_at) {
      if (!(await aiSpokeSince(customer.id, state.resumed_at))) return COMEBACK;
    }

    return '';
  } catch (err) {
    console.error(`Could not work out Lyn's opener for ${customer.id}: ${err.message}`);
    return '';
  }
}

// Put the opener in front of a message, once.
//
// A space rather than a newline: these are two sentences of one text, and a
// blank line would make a two-line message out of every introduction.
function lead(openingLine, body) {
  const text = String(body || '').trim();
  if (!openingLine) return text;
  if (!text) return openingLine;

  // Never twice. If the model has already written the introduction itself -
  // which the prompt asks it to on a first message - do not stack a second one
  // in front of it.
  if (text.startsWith(openingLine)) return text;

  return `${openingLine} ${text}`;
}

module.exports = {
  NAME,
  INTRODUCTION,
  COMEBACK,
  ESCALATION,
  NEW_THREAD_DAYS,
  SAID_IT,
  opener,
  lead,
  everIntroduced,
};
