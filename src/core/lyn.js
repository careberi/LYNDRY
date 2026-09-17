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

// ESCALATION WAS HERE AND IS GONE. DO NOT PUT IT BACK.
//
// It read "One second, let me get a manager." - Neil's own wording, chosen over
// two alternatives on the morning of 16 September, and withdrawn by him the
// same evening:
//
//   "Do not text the customer 'a manager will come back' or 'let me get a
//    manager'. Send them nothing at the moment of handoff. I talk to them when
//    I am ready."
//
// The sentence is a promise with a clock on it. It starts somebody waiting, and
// if the person replies an hour later the message is what turned a delay into a
// broken promise. handoff_to_human returns null now; everything else about the
// handoff - the issue, the page, the pause - is unchanged.

// NEW_THREAD_DAYS WAS HERE AND IS GONE. DO NOT PUT IT BACK.
//
// It was 14, and it meant: two weeks of silence is somebody coming back rather
// than continuing, so introduce her again. Neil, 17 September, reversing it in
// one line - the introduction goes "only on the first AI reply to a brand-new
// customer", and somebody returning after a fortnight is not brand new. They
// have a whole thread behind them.
//
// The old reasoning is not wrong about people, it is wrong about this product:
// a customer who booked a wash last month and texts again knows perfectly well
// what they are texting. Re-announcing is the machine behaviour, not the
// courtesy.

// Has Lyn ever told THIS customer what she is?
//
// Matched on the sentence rather than on a flag, which reads as crude and is
// the honest test: the question is whether the words ever reached their phone.
//
// IT IS NO LONGER WHAT DECIDES. It used to be the whole rule - never said it,
// so say it - and that is exactly what put it in front of Pamela, Shamar and
// every other customer who has been on the books since before Lyn had a name.
// brandNew() decides now, and this is kept as the second half of a belt and
// braces: whatever else is true, she never says it twice.
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

// ---------------------------------------------------------------------------
// IS THIS SOMEBODY WE HAVE NEVER REALLY SPOKEN TO?
//
// Neil's rule, 17 September, and it is the whole of who hears the disclosure:
//
//   "must go only on the first AI reply to a brand-new customer (no earlier
//    outbound from us except the canned website welcome). Do not put it on an
//    existing customer mid-thread. Do not put it on Demo, Pamela, Shamar, or
//    anyone who already has a message history."
//
// WHAT IT REPLACED, because the old rule is the reason he had to say this. It
// was "has she ever said it on this thread", which is a fair question and the
// wrong one: nobody had heard it, because the words were three days old - so
// every customer on the books was owed an introduction on their very next
// message. A person who has been texting us for a fortnight being told what she
// is reads as the system forgetting them, which is the opposite of the point.
//
// SO IT COUNTS WHAT WE HAVE SENT, NOT WHAT WE HAVE SAID. One outbound at most,
// and that one has to be the canned first-contact welcome. Anything else - a
// nudge, a chase, a status text, a reminder, a message somebody typed by hand -
// means there is a relationship here already and she introduces nothing.
//
// THE COST, SAID OUT LOUD: somebody who got the welcome, never replied, got a
// chase a day later, and THEN texts back never hears the disclosure. That is
// two outbound, so they are not brand new by this rule. It is the direction
// Neil chose and it is the safe one - a missed disclosure on one thread against
// announcing herself to people who have known us for weeks.
//
// TWO ROWS IS ALL IT READS. The question is "is there more than one", so there
// is nothing to gain from fetching a whole thread.
// ---------------------------------------------------------------------------
async function brandNew(customerId) {
  const { data, error } = await db
    .from('messages')
    .select('body, sent_by')
    .eq('customer_id', customerId)
    .eq('direction', 'OUTBOUND')
    .order('created_at', { ascending: true })
    .limit(2);

  if (error) throw error;

  const sent = data || [];
  if (!sent.length) return true;
  if (sent.length > 1) return false;

  return isFirstContact(sent[0]);
}

// Was that one outbound the canned welcome, or was it a person starting a
// conversation?
//
// TWO TESTS, AND THE FIRST IS THE RELIABLE ONE. `sent_by` is set by exactly one
// thing - a person typing into the conversation screen - so a message carrying
// it is never a canned anything. That covers POST /ops/messages/new, which is
// Neil texting somebody he met at a laundromat: they reply, and they are not a
// brand-new customer being onboarded, they are somebody he is already talking
// to.
//
// The second matches the sentence every first-contact message carries, from
// onboarding.FIRST_CONTACT. That covers all four doors at once - the website
// form, the Facebook lead, the door hanger, and the AI's own opener - because
// every one of them is built out of introduction(). A text blast, a reminder or
// a nudge does not contain it and so does not qualify.
//
// REQUIRED LAZILY, like ai-pause below: onboarding reaches booking, which
// reaches a good deal of the rest of the system, and a top-level require here
// is a loop waiting to be closed.
function isFirstContact(message) {
  if (!message) return false;

  // Somebody typed it. Not a welcome, whatever it says.
  if (message.sent_by) return false;

  const { FIRST_CONTACT } = require('./onboarding');
  return String(message.body || '').includes(FIRST_CONTACT);
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
//   INTRODUCTION  this is her first reply to somebody we have never really
//                 spoken to - see brandNew(). DISCLOSURE WINS over the
//                 comeback: somebody who does not know what they are talking to
//                 needs telling more than somebody who knows and has been away
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
    // BRAND NEW FIRST, AND IT IS THE ONLY WAY IN. An existing customer never
    // reaches the introduction however long the thread has been quiet and
    // whether or not the words have ever been said to them.
    if (await brandNew(customer.id)) {
      // Belt and braces. brandNew() already implies she cannot have said it -
      // the one outbound allowed is the welcome, which does not carry the
      // sentence - so this only fires if something changes upstream. It costs
      // one indexed lookup on the rarest path there is.
      if (!(await everIntroduced(customer.id))) return INTRODUCTION;
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
  SAID_IT,
  opener,
  lead,
  everIntroduced,
  brandNew,
  isFirstContact,
};
