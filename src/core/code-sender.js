'use strict';

// ---------------------------------------------------------------------------
// A SIGN-IN CODE IS WRITTEN NOW AND TEXTED TEN SECONDS LATER. BOTH SIGN-INS.
//
// Neil, 11 September: "enter your phone number, and then after ten seconds,
// the code is sent to the phone." The customer sign-in already worked this way
// and the staff sign-in did not - it texted inside the request - so the one he
// uses every day was the one that ignored the rule. One implementation now,
// used by src/core/admin-auth.js and src/core/customer-auth.js, so the two
// cannot come apart again.
//
// ONE PENDING SEND PER NUMBER, AND A SECOND REQUEST REPLACES THE FIRST. This is
// what makes the wait safe rather than a new bug. Both verifyCode()s accept the
// NEWEST unconsumed code, so somebody tapping "Send another code" twice inside
// the window would otherwise get two texts of which only the second works - and
// the first to arrive is the one they would try. Cancelling the waiting send
// means one text per burst of taps, carrying the code that will be accepted.
//
// A DEPLOY INSIDE THE WINDOW MUST NOT SWALLOW A CODE. The row is already in the
// database, so flush() sends everything still waiting; shutdown() in
// src/index.js calls it for both senders. Timers are unref'd, so a waiting code
// never holds the process open.
// ---------------------------------------------------------------------------

function createCodeSender({ delayMs, send }) {
  const pending = new Map();

  async function deliver(phone, entry) {
    pending.delete(phone);
    try {
      await send(phone, entry.text);
    } catch (err) {
      // What to do about a failed send differs between the two sign-ins - the
      // staff one writes the code to the log as a way back in, the customer one
      // must not - so the caller decides.
      if (entry.onFailure) entry.onFailure(err);
    }
  }

  // Returns a promise that resolves once the send is scheduled (or, with no
  // delay, once it has been attempted). Never rejects.
  function schedule(phone, text, onFailure = null) {
    const waiting = pending.get(phone);
    if (waiting) clearTimeout(waiting.timer);

    const entry = { text, onFailure, timer: null };

    if (!(delayMs > 0)) return deliver(phone, entry);

    entry.timer = setTimeout(() => {
      deliver(phone, entry).catch(() => {});
    }, delayMs);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();

    pending.set(phone, entry);
    return Promise.resolve();
  }

  async function flush() {
    const waiting = [...pending.entries()];
    pending.clear();
    for (const [, entry] of waiting) clearTimeout(entry.timer);
    await Promise.all(waiting.map(([phone, entry]) => deliver(phone, entry)));
  }

  return { schedule, flush, delayMs, pendingCount: () => pending.size };
}

module.exports = { createCodeSender };
