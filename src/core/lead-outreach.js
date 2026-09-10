'use strict';

const db = require('../db');

// ---------------------------------------------------------------------------
// HAS ANYBODY ACTUALLY SPOKEN TO THIS LEAD.
//
// Neil, 10 September: "stop doing automated outreach... I need a call with
// these people." The screen at /ops/leads is where he works that list, and
// this is what it reads.
//
// THIS IS THE ONE FACT IN THE SYSTEM THAT CANNOT BE DERIVED, and it is worth
// saying so loudly because the rule everywhere else is the opposite. A text
// leaves a row in `messages`; an order leaves a row in `orders`; where the
// driver is up to is read back off the timestamps he created by doing the
// work. A PHONE CALL LEAVES NOTHING. If it is not written down at the moment
// it happens, "did anybody ring this person" has no answer anywhere.
//
// Same category as orders.reminder_sent_at, and the same discipline applies:
// stored once, at the only moment it is knowable, and every screen reads the
// same answer off it rather than keeping its own.
//
// APPEND ONLY. Nothing here updates or deletes a row, because you ring
// somebody, get voicemail, ring again on Thursday, then text - and a record
// that keeps only the last of those cannot answer "how many times have we
// tried", which is the question that decides whether to try again.
// ---------------------------------------------------------------------------

// WHAT WAS DONE, NOT HOW IT WENT. Neil asked for call or text. The other two
// are the outcomes of a call that mean "I tried and did not speak to them",
// and they earn their place by being the difference between a number to leave
// alone and a number to ring again tomorrow. Folding them into CALL would mean
// a no-answer reads as reached out and nobody ever calls back.
const METHODS = Object.freeze({
  CALL: 'Called and spoke to them',
  VOICEMAIL: 'Left a voicemail',
  NO_ANSWER: 'Rang, no answer',
  TEXT: 'Sent a text',
});

// Which of those count as having actually got through. A voicemail and a
// no-answer are attempts, not contact, and the screen counts them separately -
// otherwise "12 reached" includes eight people who have heard nothing.
const SPOKE = Object.freeze(['CALL', 'TEXT']);

function isMethod(m) {
  return Object.prototype.hasOwnProperty.call(METHODS, String(m || ''));
}

// ---------------------------------------------------------------------------
// Record one attempt.
//
// Takes the lead id rather than a phone number: the same person filling the
// form twice is two leads, deliberately, and an attempt belongs to the one
// that was on screen when the button was pressed.
// ---------------------------------------------------------------------------
async function record({ leadId, method, byUserId = null, note = null }) {
  if (!leadId) throw new Error('an attempt needs a lead');
  if (!isMethod(method)) throw new Error(`${method} is not a way of reaching somebody`);

  const { data, error } = await db
    .from('lead_outreach')
    .insert({
      lead_id: String(leadId),
      method,
      by_user_id: byUserId || null,
      // An empty box is nothing to say, not an empty string to store.
      note: String(note || '').trim() || null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// Undo the last attempt on a lead, for a button pressed by mistake.
//
// THE ONLY DELETE IN HERE, and it is deliberately narrow: the newest row on
// one lead, nothing else. A mis-tap should be fixable, and a log nobody can
// correct is one people stop trusting - but "clear this lead's history" is not
// something worth building, because the history is the point.
async function undoLast(leadId) {
  const { data, error } = await db
    .from('lead_outreach')
    .select('id')
    .eq('lead_id', String(leadId))
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { error: gone } = await db.from('lead_outreach').delete().eq('id', data.id);
  if (gone) throw gone;
  return data.id;
}

// ---------------------------------------------------------------------------
// Every attempt on a set of leads, grouped by lead, newest first.
//
// ONE QUERY FOR THE WHOLE PAGE rather than one per row. The list is short
// today and will not always be, and a screen that fires a query per lead is
// one that gets slower every time the adverts work.
// ---------------------------------------------------------------------------
async function forLeads(leadIds) {
  const ids = (leadIds || []).filter(Boolean).map(String);
  if (!ids.length) return {};

  const { data, error } = await db
    .from('lead_outreach')
    .select('*, ops_users (name)')
    .in('lead_id', ids)
    .order('at', { ascending: false });

  if (error) throw error;

  const by = {};
  (data || []).forEach((row) => {
    (by[row.lead_id] ||= []).push(row);
  });
  return by;
}

// ---------------------------------------------------------------------------
// WHAT STATE IS THIS LEAD IN. Derived from the attempts, never stored.
//
// The three answers the screen sorts on, in the order they need working:
//
//   NEW       nobody has done anything. This is the list to work today
//   TRIED     somebody rang and did not get them. Worth another go
//   REACHED   we have actually spoken to them or texted them
//
// A lead the old sweep auto-texted is NOT reached. That message went out
// before this decision was taken, it is exactly the outreach that was not
// working, and counting it as contact would hide the fifteen people this
// screen exists to put back in front of somebody.
// ---------------------------------------------------------------------------
function stateOf(attempts) {
  const list = attempts || [];
  if (!list.length) return 'NEW';
  return list.some((a) => SPOKE.includes(a.method)) ? 'REACHED' : 'TRIED';
}

module.exports = { METHODS, SPOKE, isMethod, record, undoLast, forLeads, stateOf };
