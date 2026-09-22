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

// WHEN A THREAD COUNTS AS A NEW ONE. There is no thread object - a phone number
// has one continuous log - so "a genuinely new conversation" has to be a gap.
// Two weeks of silence before they spoke is somebody starting again rather than
// continuing.
//
// THE GAP IS MEASURED BEFORE WHAT THEY HAVE JUST SENT, and until 21 September
// it was not. It was measured from the newest message on the thread, which is
// always the inbound being answered, seconds old - so the gap was always
// seconds and this rule never fired once.
const NEW_THREAD_DAYS = 14;

// How far back isNewConversation() looks. Only the run of inbound messages at
// the head of the thread and the one message before it matter; this is enough
// to see past any realistic burst.
const THREAD_LOOKBACK = 50;

// Has Lyn ever told THIS customer what she is?
//
// Matched on the sentence rather than on a flag, which reads as crude and is
// the honest test: the question is whether the words ever reached their phone.
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

// The newest stretch of the thread, newest first.
//
// BY PHONE NUMBER, NOT BY CUSTOMER, and the first version got this wrong. A
// stranger's first text is logged before their customer row exists, so it
// carries no customer_id and nothing links it afterwards. Read by customer, a
// brand-new "hi" found an EMPTY thread - not new, so no introduction - and
// their second message then found [theirs, our reply] with nothing of theirs
// before it, which read as brand new and introduced her mid-conversation. The
// exact opposite of the rule, on the commonest way a customer arrives. The
// thread screen groups by number for the same reason.
async function recentThread(customer) {
  const query = db
    .from('messages')
    .select('direction, created_at')
    .order('created_at', { ascending: false })
    .limit(THREAD_LOOKBACK);

  const { data, error } = await (customer.phone
    ? query.eq('phone', customer.phone)
    : query.eq('customer_id', customer.id));

  if (error) throw error;
  return data || [];
}

// IS THIS SOMEBODY STARTING A CONVERSATION, OR SOMEBODY IN THE MIDDLE OF ONE?
//
// Neil's locked rule, 21 September: Lyn identifies herself once, to a brand-new
// customer or at the start of a new thread, and never mid-conversation.
//
// Until then she introduced herself to anybody she had never introduced herself
// to, which sounds the same and is not. Every customer who talked to us before
// Lyn had a name had never been told, so the next reply to them - in the middle
// of a booking, answering "what time tomorrow?" - opened with "Hi, I'm Lyn,
// LYNDRY's automated assistant." That is the mid-conversation introduction he
// ruled out.
//
// Pure, so it can be tested without a database. `messages` is newest first,
// each { direction, created_at }. `complete` says whether that is the whole
// thread or only the newest THREAD_LOOKBACK rows of it.
//
//   - The run of INBOUND messages at the head is what she is answering now.
//     A burst of three is one person starting one conversation.
//   - Nothing from them before that run: a brand-new customer. Our own
//     messages before it - the website welcome, the Facebook lead text, a
//     person texting them first - are us speaking, not a conversation.
//   - Something from them before it: new only if the thread had been silent
//     for NEW_THREAD_DAYS when they started this run.
//
// Anything it cannot see clearly is NOT new, which fails to silence the same
// way opener() does.
function isNewConversation(messages, { complete = true } = {}) {
  const list = messages || [];

  let run = 0;
  while (run < list.length && list[run].direction === 'INBOUND') run += 1;

  // Nothing waiting from them: this is not a reply to anybody.
  if (run === 0) return false;

  // Every row we fetched is theirs. If that is the whole thread they are new;
  // if it is only the newest page of it, we cannot tell.
  if (run === list.length) return Boolean(complete);

  const before = list.slice(run);
  // Only us before this. Brand new - unless there is more thread beyond what we
  // fetched, where they may well have spoken.
  if (!before.some((m) => m.direction === 'INBOUND')) return Boolean(complete);

  const startedAt = new Date(list[run - 1].created_at).getTime();
  const lastBefore = new Date(before[0].created_at).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(lastBefore)) return false;

  return startedAt - lastBefore >= NEW_THREAD_DAYS * 86_400_000;
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
//   INTRODUCTION  she has never said what she is on this thread, AND this is
//                 the start of a conversation - a brand-new customer, or one
//                 coming back after NEW_THREAD_DAYS of silence. Once, ever:
//                 somebody she has already introduced herself to is never told
//                 again. DISCLOSURE WINS over the comeback: somebody who does
//                 not know what they are talking to needs telling more than
//                 somebody who knows and has been away
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
    if (!(await everIntroduced(customer.id))) {
      const thread = await recentThread(customer);
      if (isNewConversation(thread, { complete: thread.length < THREAD_LOOKBACK })) return INTRODUCTION;
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
//
// THE CODE IS THE ONLY THING THAT INTRODUCES HER. The model is told never to,
// and if it does anyway its introduction comes off the front of the reply -
// whether or not one is owed. Not owed, that is the mid-conversation
// introduction Neil ruled out; owed, it would stack a second one behind ours.
//
// Only a sentence that is NOTHING BUT an introduction is taken: "I'm Lyn.",
// "Hi, I'm Lyn, LYNDRY's automated assistant.", "This is Lyn from LYNDRY!",
// "it's Lyn again." Not "Hi, I'm Lyn, and I can grab it tomorrow at 6." - that
// carries the answer in the same sentence, and losing the answer is worse than
// a spare introduction. Curly apostrophes too: the model reaches for them and
// notify.js only straightens them later.
const MODEL_INTRO = new RegExp(
  '^(?:(?:hi|hey|hello)\\b[\\s,!.]*)?' +
    "(?:i[’']m|i am|this is|it[’']s)\\s+lyn\\b" +
    "(?:\\s+again|\\s+here|,?\\s+(?:lyndry[’']s|from lyndry|with lyndry|at lyndry)(?:\\s+[a-z]+){0,3})?" +
    '\\s*[.!?]+\\s*',
  'i'
);

// A bare greeting at the front of a reply: "Hey!", "Hi there,", "Hello.".
const GREETING = /^(?:hi|hey|hello|hiya)(?:\s+there)?\s*[!,.]+\s*/i;

function lead(openingLine, body) {
  let text = String(body || '').trim();

  // Leave our own words alone: an opener the model copied exactly is handled
  // by the startsWith below, and the comeback is not an introduction.
  //
  // AND A REPLY THAT IS NOTHING BUT AN INTRODUCTION IS KEPT. That is almost
  // always the answer to "who is this?" or "am I talking to a person?", which
  // the prompt tells her to answer with exactly that - and stripping it would
  // send nothing at all to somebody who asked a direct question.
  if (!(openingLine && text.startsWith(openingLine))) {
    const stripped = text.replace(MODEL_INTRO, '').trim();
    if (stripped) text = stripped;

    // ...unless our opener is already that introduction. On a first reply the
    // opener is the introduction AND the offer, so "who is this?" answered with
    // nothing but "I'm Lyn" would otherwise read "Hi, I'm Lyn... 50% off...
    // I'm Lyn, LYNDRY's automated assistant." The opener answers it on its own.
    else if (openingLine && openingLine.startsWith(INTRODUCTION)) return openingLine;
  }

  if (!openingLine) return text;
  if (!text) return openingLine;

  // Never twice.
  if (text.startsWith(openingLine)) return text;

  // ONE GREETING. Both openers begin "Hi,", and the model greets somebody new
  // with "Hey! How can I help?" - which it should, because it cannot know an
  // opener is coming. "Hi, I'm Lyn... Hey! How can I help?" says hello twice.
  // Only a bare greeting word comes off; anything after it stays.
  if (/^hi\b/i.test(openingLine)) {
    const rest = text.replace(GREETING, '').trim();
    if (rest) text = rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  return `${openingLine} ${text}`;
}

module.exports = {
  NAME,
  INTRODUCTION,
  COMEBACK,
  NEW_THREAD_DAYS,
  SAID_IT,
  opener,
  lead,
  isNewConversation,
  everIntroduced,
};
