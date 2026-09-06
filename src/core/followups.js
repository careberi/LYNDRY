'use strict';

const db = require('../db');
const booking = require('./booking');
const brain = require('./brain');
const orders = require('./orders');
const issues = require('./issues');
const notify = require('./notify');
const aiPause = require('./ai-pause');
const settings = require('./settings');

// ---------------------------------------------------------------------------
// CHASE ONCE, THEN LEAVE THEM ALONE.
//
// Neil's ask. The AI asks somebody a question - what's your address, what time
// suits - and they never answer. Nothing in the system noticed, so a half-set-up
// customer just sat there for ever. A day later we chase it, once.
//
// THE RULES, and the second one is the whole point:
//
//   1. The last message in the thread is the AI's own reply, 24 hours old.
//   2. ONE CHASE PER SILENCE. A follow-up is written as kind FOLLOW_UP, so the
//      last message is then a follow-up rather than an AI reply and rule 1 can
//      never fire again. Following up on a follow-up is impossible rather than
//      discouraged. Only the customer speaking resets it.
//   3. There has to have been a conversation. A single exchange - they said
//      "thanks", we said "no problem" - is not something to chase.
//   4. Nothing booked. The point is to get somebody over the line; a customer
//      with a pickup coming does not need us texting them about it.
//
// WHY THE AI WRITES THIS ONE, when the nudge buttons in src/core/nudges.js are
// fixed sentences. Those ask for one of five known-missing things and can be
// written out in advance. This has to refer to a conversation that could have
// been about anything, so a fixed sentence would be "just following up!" - which
// is worse than nothing and reads like a machine. The model gets the thread and
// one job: write the shortest possible nudge back to your own last question.
//
// It is still not trusted blindly. The reply goes through notify like every
// other message, so it is forced to plain ASCII and logged; and if the model
// returns nothing usable, nothing is sent.
// ---------------------------------------------------------------------------

const AFTER_HOURS = Number(process.env.FOLLOW_UP_AFTER_HOURS || 24);

// A conversation, not an exchange. Their side has to have spoken at least once
// and ours at least twice - which is the shape Neil described: we say
// something, they answer, we say something, silence.
const MIN_FROM_THEM = 1;
const MIN_FROM_US = 2;

// How far back to look for threads. A chase is due at 24 hours; if we have been
// down for a week, a stale chase is not what needs fixing.
const WINDOW_DAYS = 7;

// The hours anything unprompted may be sent, in New Jersey. The scheduler is
// what enforces this; the same numbers live here so the time shown on the ops
// screen is the time the scheduler would actually send at.
const QUIET_START = 8;
const QUIET_END = 21;

const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

// The hour of a moment, in New Jersey rather than wherever the server is.
function serviceHour(date) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: booking.SERVICE_TZ,
      hour: '2-digit',
      hour12: false,
    }).format(date)
  );
}

// When the chase for this thread will actually go out: 24 hours after the AI's
// last word, PUSHED OUT OF QUIET HOURS.
//
// The clamp is not cosmetic. Nothing unprompted may be sent outside 8am to 9pm,
// so a chase falling due at 7:29am goes at 8, and one falling due at half nine
// at night goes the next morning. The ops screen shows this number, and a
// screen promising a text at half seven that the scheduler would never send is
// worse than no screen - so the time shown is the time it happens.
function dueAt(lastAt) {
  const due = new Date(new Date(lastAt).getTime() + AFTER_HOURS * 3_600_000);

  // Walk forward an hour at a time rather than doing date arithmetic across a
  // timezone. It is at most sixteen steps and it cannot get daylight saving
  // wrong, which the arithmetic version would twice a year.
  const out = new Date(due);
  for (let i = 0; i < 24; i += 1) {
    const hour = serviceHour(out);
    if (hour >= QUIET_START && hour < QUIET_END) break;
    out.setUTCHours(out.getUTCHours() + 1, 0, 0, 0);
  }

  return out;
}

// Does this thread earn a chase? Takes the messages for ONE phone number,
// oldest first. Returns null, or why it is due.
//
// Kept as a pure function so both the sweep and the ops screen ask the same
// question of the same data - the screen says "follow-up scheduled for X" and
// the sweep sends it, and those two must never disagree.
function assess(thread) {
  if (!thread.length) return null;

  const last = thread[thread.length - 1];

  // Rule 1 and rule 2 in one line. Anything other than an AI reply - a
  // confirmation, a status text, an apology, a person's own message, or a
  // follow-up we already sent - means we are not waiting on them.
  if (last.direction !== 'OUTBOUND' || last.kind !== 'AI') return null;

  const fromThem = thread.filter((m) => m.direction === 'INBOUND').length;
  const fromUs = thread.filter((m) => m.direction === 'OUTBOUND').length;

  if (fromThem < MIN_FROM_THEM || fromUs < MIN_FROM_US) return null;

  return { lastAt: last.created_at, dueAt: dueAt(last.created_at) };
}

// Every thread in the recent window, oldest message first, keyed by phone.
//
// One query and grouped in memory, the same shape the conversations screen
// uses. At this volume that is nothing; if it ever stops being nothing, the
// window above is the knob.
async function recentThreads() {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3_600_000).toISOString();

  const { data, error } = await db
    .from('messages')
    .select('phone, direction, kind, body, created_at, customer_id')
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const byPhone = new Map();
  for (const m of data || []) {
    if (!byPhone.has(m.phone)) byPhone.set(m.phone, []);
    byPhone.get(m.phone).push(m);
  }
  return byPhone;
}

// IS A CHASE PENDING FOR THIS NUMBER, and when. Used by the conversation screen
// so a person can see one coming before it lands, which is what Neil asked for:
// nothing should text a customer at a time nobody could have predicted.
async function pendingFor(phone) {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3_600_000).toISOString();

  const { data, error } = await db
    .from('messages')
    .select('phone, direction, kind, created_at')
    .eq('phone', phone)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return assess(data || []);
}

// Ask the AI for the sentence. Null if it cannot produce a usable one, and a
// follow-up that cannot be written is simply not sent.
async function compose(customer, thread) {
  const [order, recentOrders] = await Promise.all([
    orders.findLatestInFlight(customer.id).catch(() => null),
    Promise.resolve([]),
  ]);

  const recentMessages = thread.slice(-10).map((m) => ({
    direction: m.direction,
    body: m.body,
    created_at: m.created_at,
    sent_by: m.sent_by || null,
  }));

  const text = await brain.followUpMessage({ customer, order, recentMessages, recentOrders });

  const clean = String(text || '').trim();
  if (!clean) return null;

  // A chase is a nudge, not a second conversation. Anything long enough to be
  // three segments is the model starting again rather than following up, and
  // is thrown away rather than sent.
  if (notify.describeCost(notify.toPlainText(clean)).segments > 2) {
    console.warn(`Follow-up for ${customer.phone} came back too long, not sending.`);
    return null;
  }

  return clean;
}

// The sweep. Everything due, sent, in one pass.
async function sendDue({ now = null } = {}) {
  // THE SWITCH, checked before anything is read. Off means off everywhere -
  // see migration 0067. Switching the AI off for one conversation already
  // stops that one, because a chase is the AI speaking.
  if (!(await settings.followUpsOn())) {
    return { sent: [], skipped: [], off: true };
  }

  const threads = await recentThreads();
  const sent = [];
  const skipped = [];

  for (const [phone, thread] of threads) {
    const due = assess(thread);
    if (!due) continue;
    if (hoursSince(due.lastAt) < AFTER_HOURS) continue;

    const customerId = thread[thread.length - 1].customer_id;
    if (!customerId) {
      skipped.push({ phone, reason: 'no customer' });
      continue;
    }

    try {
      const { data: customer } = await db
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .maybeSingle();

      if (!customer) {
        skipped.push({ phone, reason: 'customer gone' });
        continue;
      }

      // STOP is a legal instruction, and it outranks everything here.
      if (customer.status === 'UNSUBSCRIBED') {
        skipped.push({ phone, reason: 'opted out' });
        continue;
      }

      // A person has taken this conversation over. The AI says nothing at all
      // while that is true, and a chase is the AI speaking.
      if (await aiPause.isPaused(phone)) {
        skipped.push({ phone, reason: 'a person is handling it' });
        continue;
      }

      // The AI gave up on this thread and somebody owes them a real answer.
      // Chasing on top of that is the machine talking over the person.
      if (await issues.holdFor(customer.id).catch(() => null)) {
        skipped.push({ phone, reason: 'the AI is on hold here' });
        continue;
      }

      // Rule 4. They are already booked; there is nothing to chase them for.
      if (await orders.findAwaitingCollection(customer.id).catch(() => null)) {
        skipped.push({ phone, reason: 'already has a pickup booked' });
        continue;
      }

      const body = await compose(customer, thread);
      if (!body) {
        skipped.push({ phone, reason: 'nothing worth sending' });
        continue;
      }

      // KIND FOLLOW_UP IS WHAT STOPS THE NEXT ONE. Written here rather than
      // left to a caller, because a chase logged as an ordinary AI reply would
      // be chased again tomorrow, and again the day after.
      await notify.sendAndLog(phone, body, customer.id, { kind: 'FOLLOW_UP' });

      sent.push({ phone, body });
      console.log(`FOLLOWUP ${phone}: ${body}`);
    } catch (err) {
      skipped.push({ phone, reason: err.message });
      console.error(`Follow-up for ${phone} failed: ${err.message}`);
    }
  }

  if (sent.length || skipped.length) {
    console.log(`Follow-ups: ${sent.length} sent, ${skipped.length} not.`);
  }

  return { sent, skipped };
}

module.exports = {
  sendDue,
  pendingFor,
  assess,
  dueAt,
  AFTER_HOURS,
  MIN_FROM_THEM,
  MIN_FROM_US,
};
