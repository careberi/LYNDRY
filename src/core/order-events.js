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
// ---------------------------------------------------------------------------

// `by` is whatever the caller knows about who did it:
//   { opsUser }   a signed-in person, the usual case on the ops screens
//   { actor }     'partner', 'customer', 'system' when there is no person
async function record(orderId, { kind, summary, was, became, by = {}, reason = null }) {
  if (!orderId || !kind || !summary) return null;

  const opsUser = by.opsUser || null;

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

module.exports = { record, forOrder };
