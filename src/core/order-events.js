'use strict';

const db = require('../db');

// ---------------------------------------------------------------------------
// The order's own history.
//
// An order row tells you where it IS. This tells you how it got there: that it
// was weighed twice and the second was 4 lb lighter, that a laundromat put it
// 3 lb heavier, which driver tapped delivered, why a charge was waived.
//
// When a customer rings about a bill, "the order says $80" is not an answer.
// The question is always how it came to say $80, and until now nothing in the
// system could tell you.
//
// TWO RULES.
//
//   1. APPEND ONLY. Nothing here updates or deletes. A log that can be tidied
//      up afterwards is not evidence of anything, and the whole value of this
//      table is that it cannot be.
//
//   2. RECORDING NEVER BREAKS THE THING BEING RECORDED. Every write is inside
//      a try/catch that logs and moves on. A driver at a door must never be
//      stopped by the audit trail failing - the delivery is the real work and
//      this is the note about it.
//
//   3. ONE TAP IS ONE ROW. Added 16 September, from reading the real log rather
//      than the code: #2068 carried "K3CPQF-1 weighed back at 1 lb" twice 0.44s
//      apart, #2064 "WZ7MZ8 handed to the laundromat, van clip 10 off" twice,
//      #2062 "Weighed 19 lb" AND "Priced $38.00 at $2.00 a pound" twice, and
//      #2060 and #2062 both said "N bags at the door" twice. Every one of them
//      is a driver's second tap on a form that had not answered yet, or a
//      browser re-posting - not two things happening.
//
//      A doubled row is not neutral. This log is what a price dispute is
//      settled from, and "weighed 19 lb / weighed 19 lb" reads as the bag going
//      on the scale twice. It also buries the one row that matters.
//
//      IT DECLINES TO APPEND; IT NEVER TIDIES UP. Rule 1 is untouched - nothing
//      here updates or deletes, and a duplicate already written stays written.
//      What changed is that an identical row arriving seconds after the last
//      one is not added, which is the only point at which a log this shape can
//      be kept clean without editing it afterwards.
// ---------------------------------------------------------------------------

// HOW CLOSE COUNTS AS THE SAME TAP. Every duplicate found in the live log was
// under 2.5 seconds apart; this is wide enough for a phone on two bars and a
// driver tapping again, and far too narrow to swallow a deliberate repeat. A
// second identical row a minute later is somebody genuinely doing it twice and
// is still recorded.
const SAME_TAP_SECONDS = 15;

// Whether this row says the same thing as the one before it. Deliberately the
// whole sentence and not a prefix: "bag 1 weighed at 18 lb" and "bag 2 weighed
// at 18 lb" are two bags, and only an exact match is a repeat.
function sameAs(previous, { kind, summary, was, became }) {
  if (!previous) return false;

  const age = Date.now() - new Date(previous.created_at).getTime();
  if (!(age >= 0 && age < SAME_TAP_SECONDS * 1000)) return false;

  const same = (a, b) => (a == null ? null : String(a)) === (b == null ? null : String(b));

  return (
    previous.kind === kind &&
    same(previous.summary, String(summary).slice(0, 400)) &&
    same(previous.was, was == null ? null : String(was).slice(0, 200)) &&
    same(previous.became, became == null ? null : String(became).slice(0, 200))
  );
}

// The last row of THIS KIND on this order, or null if we cannot tell.
//
// OF THIS KIND, NOT SIMPLY THE LAST ROW, and that is the difference between
// this working and not. One weigh writes a WEIGHT and then a PRICE, so a
// double-submit lands W, P, W, P - and against "the last row" the second W is
// compared to a P, matches nothing and is written. #2062 is exactly that shape.
//
// FAILS OPEN on purpose: if the lookup itself is broken we write the row
// anyway, because a duplicate in the log is a blemish and a missing row is
// evidence gone.
async function lastEvent(orderId, kind) {
  try {
    const { data, error } = await db
      .from('order_events')
      .select('kind, summary, was, became, created_at')
      .eq('order_id', orderId)
      .eq('kind', kind)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (err) {
    console.error(`Could not read the last ${kind} event on ${orderId}: ${err.message}`);
    return null;
  }
}

// `by` is whatever the caller knows about who did it:
//   { opsUser }   a signed-in person, the usual case on the ops screens
//   { actor }     'partner', 'customer', 'system' when there is no person
async function record(orderId, { kind, summary, was, became, by = {}, reason = null }) {
  if (!orderId || !kind || !summary) return null;

  const opsUser = by.opsUser || null;

  // One tap is one row - see rule 3 above.
  if (sameAs(await lastEvent(orderId, kind), { kind, summary, was, became })) return null;

  try {
    const { data, error } = await db
      .from('order_events')
      .insert({
        order_id: orderId,
        kind,
        summary: String(summary).slice(0, 400),
        was: was == null ? null : String(was).slice(0, 200),
        became: became == null ? null : String(became).slice(0, 200),
        ops_user_id: opsUser ? opsUser.id : null,
        // A person's name is the most useful label, so it wins over the
        // generic word when we have one.
        actor: opsUser ? opsUser.name || 'staff' : by.actor || 'system',
        reason: reason ? String(reason).slice(0, 400) : null,
      })
      .select('*')
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    // Loud in the log, invisible to the person doing the work.
    console.error(`Could not record an order event (${kind}) on ${orderId}: ${err.message}`);
    return null;
  }
}

async function forOrder(orderId, { limit = 200 } = {}) {
  const { data, error } = await db
    .from('order_events')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

module.exports = { record, forOrder, sameAs, SAME_TAP_SECONDS };
