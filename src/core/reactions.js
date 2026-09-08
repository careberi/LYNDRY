'use strict';

// ---------------------------------------------------------------------------
// A TAPBACK IS NOT A MESSAGE.
//
// An iPhone user who long-presses one of our texts and taps the heart sends,
// over SMS, a text that reads:
//
//     Loved "Sounds good, Vered. Whenever you're ready, just send us a text"
//
// It is not something they typed and it is not something they are waiting for
// an answer to. Twice in the first week the AI answered one anyway - "Glad that
// landed! Give us a shout if anything comes up." - which is a segment billed
// for nothing, and reads to the customer as a machine that does not know what
// a thumbs-up is.
//
// So they are recognised here, in code, before the AI ever sees them. The
// message is still written to `messages` - it is what their phone sent and the
// thread should show it - but nothing replies to it, it does not restart the
// burst window, and the follow-up sweep looks straight past it when asking
// "what was the last thing said in this thread".
//
// ONLY APPLE'S WORDING IS RECOGNISED, on purpose. Android phones send a
// reaction as an emoji plus the quoted text, and a pattern loose enough to
// catch those would also catch a real message that happens to start with a
// short word and a quote. Missing an Android reaction costs one wasted reply;
// swallowing a real message costs a customer. The six Apple verbs, and the
// "Removed a ... from" form when somebody takes one back, are exact.
// ---------------------------------------------------------------------------

// Apple sends the quoted text in curly quotes, but a carrier can swap them for
// straight ones on the way through, so both are accepted.
const QUOTE = '[“"]';

const TAPBACK = new RegExp(
  `^(Liked|Loved|Disliked|Laughed at|Emphasized|Emphasised|Questioned) ${QUOTE}`
);

const TAPBACK_REMOVED = new RegExp(`^Removed (a|an) [a-z ]{1,30} from ${QUOTE}`);

function isReaction(text) {
  const t = String(text || '').trim();
  return TAPBACK.test(t) || TAPBACK_REMOVED.test(t);
}

module.exports = { isReaction };
