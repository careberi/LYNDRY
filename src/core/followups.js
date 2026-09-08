'use strict';

const db = require('../db');
const booking = require('./booking');
const brain = require('./brain');
const orders = require('./orders');
const issues = require('./issues');
const notify = require('./notify');
const aiPause = require('./ai-pause');
const settings = require('./settings');
const nudges = require('./nudges');
const reactions = require('./reactions');

// ---------------------------------------------------------------------------
// CHASE AT MOST TWICE, THEN LEAVE THEM ALONE.
//
// Neil's ask. The AI asks somebody a question - what's your address, what time
// suits - and they never answer. Nothing in the system noticed, so a half-set-up
// customer just sat there for ever. So we chase it.
//
// IT WAS ONCE, A DAY LATER, AND THAT WAS TOO SLOW FOR ONE CASE. People who
// reply to us do it in one to twenty minutes; somebody who says "Yes" to a
// pickup and then never gives a name has not lost interest, they have put the
// phone down. A day later the moment has gone. Neil's call, with the
// alternatives in front of him: one earlier nudge, a couple of hours in, ONLY
// for somebody part-way through setting up - and then the day-later one, and
// then nothing. Not the four-step ladder that was proposed, which is roughly
// four times the outbound to people who have not replied, at a time when the
// carrier registration is still pending.
//
// THE RULES, and the cap is the whole point:
//
//   1. The last thing said in the thread is ours - the AI's own reply, or a
//      chase we already sent. A confirmation, a status text, a person typing,
//      or the customer speaking all mean we are not waiting on them.
//   2. AT MOST TWO CHASES PER SILENCE. The early one goes EARLY_HOURS after the
//      AI's question, and only when the customer is mid-setup. The final one
//      goes AFTER_HOURS after that same question. Both are written as
//      kind FOLLOW_UP; which one a chase WAS is read off its timestamp - one
//      sent inside the first day was the early one - so nothing is stored to
//      say so and nothing can disagree with the thread. Two chases since
//      their last word, or one chase sent after the day mark, and it is over.
//      Only the customer speaking starts the count again.
//   3. There has to have been a conversation. A single exchange - they said
//      "thanks", we said "no problem" - is not something to chase.
//   4. Nothing booked. The point is to get somebody over the line; a customer
//      with a pickup coming does not need us texting them about it.
//
// A TAPBACK IS NOT THEM SPEAKING. Somebody who hearts our question has not
// answered it, so reactions are looked straight past when deciding what the
// last thing said was. See src/core/reactions.js.
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

const EARLY_HOURS = Number(process.env.FOLLOW_UP_EARLY_HOURS || 2);
const AFTER_HOURS = Number(process.env.FOLLOW_UP_AFTER_HOURS || 24);

// A conversation, not an exchange. Their side has to have spoken at least once
// and ours at least twice - which is the shape Neil described: we say
// something, they answer, we say something, silence.
const MIN_FROM_THEM = 1;
const MIN_FROM_US = 2;

// How far back to look for threads. A chase is due within a day; if we have
// been down for a week, a stale chase is not what needs fixing.
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

// When a chase will actually go out: so many hours after the AI's last word,
// PUSHED OUT OF QUIET HOURS.
//
// The clamp is not cosmetic. Nothing unprompted may be sent outside 8am to 9pm,
// so a chase falling due at 7:29am goes at 8, and one falling due at half nine
// at night goes the next morning. The ops screen shows this number, and a
// screen promising a text at half seven that the scheduler would never send is
// worse than no screen - so the time shown is the time it happens.
function dueAt(lastAt, hours = AFTER_HOURS) {
  const due = new Date(new Date(lastAt).getTime() + hours * 3_600_000);

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

// Does this thread earn a chase, and which one? Takes the messages for ONE
// phone number, oldest first, and whether the customer is part-way through
// setting up. Returns null, or { stage, hours, lastAt, dueAt }.
//
// Kept as a pure function so both the sweep and the ops screen ask the same
// question of the same data - the screen says "follow-up scheduled for X" and
// the sweep sends it, and those two must never disagree.
//
// midSetup only decides WHICH chase comes first, never WHETHER. So a caller can
// ask with midSetup true to find out if a thread is a candidate at all before
// paying for the customer lookup that answers midSetup properly.
function assess(thread, { midSetup = false } = {}) {
  // A heart on our question is not an answer to it.
  const real = (thread || []).filter(
    (m) => !(m.direction === 'INBOUND' && reactions.isReaction(m.body))
  );
  if (!real.length) return null;

  const last = real[real.length - 1];
  if (last.direction !== 'OUTBOUND') return null;

  // Rule 1. Only our own AI reply, or a chase of it, may be the last word.
  // Anything else - a confirmation, a status text, a person typing, a nudge
  // button - means we are not waiting on them.
  if (last.kind !== 'AI' && last.kind !== 'FOLLOW_UP') return null;

  // Everything since they last spoke.
  let i = real.length - 1;
  while (i >= 0 && real[i].direction === 'OUTBOUND') i -= 1;
  const sinceThem = real.slice(i + 1);

  // The question we are chasing: the AI's last reply since their last word.
  const asked = [...sinceThem].reverse().find((m) => m.kind === 'AI');
  if (!asked) return null;

  // Rule 3.
  const fromThem = real.filter((m) => m.direction === 'INBOUND').length;
  const fromUs = real.filter((m) => m.direction === 'OUTBOUND').length;
  if (fromThem < MIN_FROM_THEM || fromUs < MIN_FROM_US) return null;

  // Rule 2. Which chases have already gone since they last spoke, and which
  // of the two each one was - read off when it was sent, never stored.
  const chases = sinceThem.filter((m) => m.kind === 'FOLLOW_UP');
  const dayMark = new Date(asked.created_at).getTime() + AFTER_HOURS * 3_600_000;

  const early = { stage: 'early', hours: EARLY_HOURS, lastAt: asked.created_at, dueAt: dueAt(asked.created_at, EARLY_HOURS) };
  const final = { stage: 'final', hours: AFTER_HOURS, lastAt: asked.created_at, dueAt: dueAt(asked.created_at, AFTER_HOURS) };

  if (chases.length === 0) return midSetup ? early : final;

  // One chase so far. If it went inside the first day it was the early one,
  // and the day-later one is still to come. If it went after the day mark it
  // WAS the day-later one, and that is the end.
  if (chases.length === 1 && new Date(chases[0].created_at).getTime() < dayMark) return final;

  return null;
}

// MID-SETUP: they have started and not finished.
//
// Derived from the same gaps the nudge buttons show - no name, no address, no
// wash preferences, no card - because those are the things bookPickup() will
// refuse without, and a customer stuck on one of them is exactly who the early
// nudge is for. A customer with all of it and nothing booked is not stuck, they
// are deciding, and gets the day-later chase only.
async function midSetupFor(customer) {
  if (!customer || !customer.id) return false;
  const gaps = await nudges.gapsFor(customer).catch(() => []);
  return gaps.some((g) => g.blocks);
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

  const [{ data, error }, { data: customer }] = await Promise.all([
    db
      .from('messages')
      .select('phone, direction, kind, body, created_at')
      .eq('phone', phone)
      .gte('created_at', since)
      .order('created_at', { ascending: true }),
    db.from('customers').select('*').eq('phone', phone).maybeSingle(),
  ]);

  if (error) throw error;

  // Cheap question first: is this thread a candidate at all? Only then pay
  // for the gap lookup that says which chase comes first.
  if (!assess(data || [], { midSetup: true })) return null;

  const due = assess(data || [], { midSetup: await midSetupFor(customer) });
  if (!due) return null;

  // Still returned when it is switched off, with a flag, so the conversation
  // screen can say "this one would be chased, and it will not be" rather than
  // showing nothing at all. A switch whose effect is invisible is a switch
  // nobody trusts.
  return { ...due, off: await aiPause.followUpsOff(phone) };
}

// EVERYTHING QUEUED TO GO OUT ON ITS OWN, for the screen that lists them.
//
// Reads the same threads the sweep reads and asks the same assess(), so the
// list and the send cannot disagree about who is due or when.
async function allPending() {
  const threads = await recentThreads();

  // Candidates first, so the customer lookup below is one query for the few
  // threads that matter rather than one per thread.
  const candidates = [];
  for (const [phone, thread] of threads) {
    if (assess(thread, { midSetup: true })) candidates.push({ phone, thread });
  }

  const ids = [...new Set(candidates.map((c) => c.thread[c.thread.length - 1].customer_id).filter(Boolean))];
  const { data: people } = ids.length
    ? await db.from('customers').select('*').in('id', ids)
    : { data: [] };
  const byId = new Map((people || []).map((c) => [c.id, c]));

  const rows = [];

  for (const { phone, thread } of candidates) {
    const last = thread[thread.length - 1];
    const customer = byId.get(last.customer_id) || null;
    const due = assess(thread, { midSetup: await midSetupFor(customer) });
    if (!due) continue;

    rows.push({
      phone,
      customerId: last.customer_id || null,
      stage: due.stage,
      dueAt: due.dueAt,
      lastAt: due.lastAt,
      lastMessage: last.body || '',
      overdue: hoursSince(due.lastAt) >= due.hours,
    });
  }

  // Which of them are switched off, in one query rather than one per row.
  const off = await aiPause.followUpsOffAmong(rows.map((r) => r.phone)).catch(() => new Set());
  const paused = await aiPause.pausedAmong(rows.map((r) => r.phone)).catch(() => new Set());

  for (const row of rows) {
    row.off = off.has(row.phone);
    row.paused = paused.has(row.phone);
  }

  rows.sort((a, b) => a.dueAt - b.dueAt);
  return rows;
}

// Ask the AI for the sentence. Null if it cannot produce a usable one, and a
// follow-up that cannot be written is simply not sent.
async function compose(customer, thread, { early = false } = {}) {
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

  const text = await brain.followUpMessage({ customer, order, recentMessages, recentOrders, early });

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
    // Candidate at all? And has even the early clock run? Both answerable from
    // the thread alone, before a single customer row is read.
    const maybe = assess(thread, { midSetup: true });
    if (!maybe) continue;
    if (hoursSince(maybe.lastAt) < EARLY_HOURS) continue;

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

      // Now the real question: which chase, and is it due yet.
      const due = assess(thread, { midSetup: await midSetupFor(customer) });
      if (!due) continue;
      if (hoursSince(due.lastAt) < due.hours) continue;

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

      // Chases turned off for this one number. Different from the pause above:
      // the AI still answers them, it just never starts a conversation. Neil's
      // case is a customer who has said they will come back.
      if (await aiPause.followUpsOff(phone)) {
        skipped.push({ phone, reason: 'follow-ups are off for this chat' });
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

      const body = await compose(customer, thread, { early: due.stage === 'early' });
      if (!body) {
        skipped.push({ phone, reason: 'nothing worth sending' });
        continue;
      }

      // KIND FOLLOW_UP IS WHAT COUNTS THE CHASES. Written here rather than
      // left to a caller, because a chase logged as an ordinary AI reply would
      // be chased again, and again the day after.
      await notify.sendAndLog(phone, body, customer.id, { kind: 'FOLLOW_UP' });

      sent.push({ phone, stage: due.stage, body });
      console.log(`FOLLOWUP ${phone} (${due.stage}): ${body}`);
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
  allPending,
  assess,
  dueAt,
  midSetupFor,
  EARLY_HOURS,
  AFTER_HOURS,
  MIN_FROM_THEM,
  MIN_FROM_US,
};
