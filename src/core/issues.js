'use strict';

const db = require('../db');
// booking.js is NOT required here: it is part of a require loop through this
// file, and at the top it arrives empty. See listForDay().
const roles = require('./roles');
const { config } = require('../config');
const { sendAndLog } = require('./notify');
const { site } = require('../web/site');

// ---------------------------------------------------------------------------
// Something went wrong and a person has to deal with it.
//
// Raising an issue does three things, and all three matter:
//
//   1. Writes a durable row that STAYS OPEN until a human closes it. Not until
//      the customer stops texting, not until the AI decides it is handled.
//   2. Texts every active admin, so somebody knows without watching a screen.
//   3. Puts a red banner on every ops page until it is resolved.
//
// Before this, a handoff was a line in a log file and a text to a number that
// was never configured. A customer whose shirt was ruined got "someone will
// come back to you shortly" and nobody ever did.
// ---------------------------------------------------------------------------

// Who gets told. Read from ops_users rather than an environment variable,
// because that list is already maintained on the Team page, it survives
// somebody leaving, and it works for more than one admin. SUPPORT_PHONE is
// kept as an extra recipient for whoever is not in the table.
async function alertRecipients(permission = 'issues.manage') {
  const { data, error } = await db
    .from('ops_users')
    .select('id, name, phone, role, status')
    .eq('status', 'ACTIVE');

  if (error) throw error;

  // Who can actually do something about it. An issue goes to whoever manages
  // issues; "come and collect this" goes to whoever works orders, which is a
  // different and usually larger list.
  const able = (data || []).filter((u) => roles.can(u, permission));
  const numbers = new Set(able.map((u) => u.phone).filter(Boolean));

  if (config.supportPhone) numbers.add(config.supportPhone);

  return [...numbers];
}

// Raise an issue, or return the one already open for this customer.
//
// One open issue per customer, enforced by a unique index as well as this
// check: three angry texts in three minutes is one problem, not three, and
// creating three flags means three identical replies to the customer.
async function raise({ customer, order, reason, customerSaid, aiHold = false }) {
  // AN ESCALATION SWITCHES LYN OFF, AND ONLY A PERSON SWITCHES HER BACK ON.
  //
  // Neil's rule, 16 September: "If the AI assistant is turned on, then she can
  // reply right away when the customer responds. But if the AI assistant is
  // turned off, she should not reply at all." One state decides it, so there is
  // one thing to look at and one thing to flip.
  //
  // THIS COLLAPSES A DISTINCTION THIS FILE USED TO DEFEND. The note on the
  // pause says the hold and the pause are different things - the hold being the
  // AI admitting it ran out of road and lifting ITSELF once the customer came
  // back. That self-lifting is exactly what Neil has ruled out: a manager who
  // sorts the problem out and deliberately leaves Lyn off must keep her off.
  //
  // FIRST, BEFORE THE BRANCHING, so it covers both ways in - a brand new
  // holding issue, and an existing one that becomes a hold because the AI was
  // coping and then stopped. Doing it after the insert covered only the first,
  // and the second is a thread already going wrong.
  //
  // HERE RATHER THAN AT EACH CALLER, because there are four of them: the
  // handoff, an unreachable AI, a failed action and the repeat detector.
  //
  // Lazy require - ai-pause.js reaches this file, so a top-level one would
  // close the loop. Best effort: an issue must still be raised if the pause
  // write fails, because the alternative is nobody being told at all.
  if (aiHold && customer && customer.phone) {
    await require('./ai-pause')
      .pause(customer.phone, null, 'Lyn handed this to a person.')
      .catch((err) => console.error(`Raised an issue but could not pause Lyn: ${err.message}`));
  }

  const { data: existing, error: findError } = await db
    .from('issues')
    .select('*')
    .eq('customer_id', customer.id)
    .eq('status', 'OPEN')
    .maybeSingle();

  if (findError) throw findError;

  if (existing) {
    // Already flagged. If they have now told us which order it is about and we
    // did not know before, that is worth adding.
    if (order && !existing.order_id) {
      await db.from('issues').update({ order_id: order.id }).eq('id', existing.id);
      existing.order_id = order.id;
    }
    // An issue that was a question for a person can BECOME a hold - the AI was
    // coping and then stopped coping. It never goes the other way here: only
    // an actual exchange with the customer lifts a hold.
    if (aiHold && !existing.ai_hold) {
      await db.from('issues').update({ ai_hold: true }).eq('id', existing.id);
      existing.ai_hold = true;
    }
    return { issue: existing, isNew: false };
  }

  const { data: issue, error } = await db
    .from('issues')
    .insert({
      customer_id: customer.id,
      order_id: order ? order.id : null,
      reason: String(reason || 'No reason given').slice(0, 500),
      customer_said: customerSaid ? String(customerSaid).slice(0, 500) : null,
      ai_hold: Boolean(aiHold),
    })
    .select('*')
    .single();

  if (error) throw error;

  // WHO WAS TOLD IS WRITTEN ON THE ISSUE. On 5 September a customer was
  // promised a manager, the row below was created, and the text to the
  // admins went nowhere - there was no active team member with a phone yet
  // and SUPPORT_PHONE was unset. The only trace was a block of console.error
  // in a deploy log nobody was reading, and the issue was later marked
  // resolved without her ever hearing back. paged_at being null on an open
  // issue is now a red line on the Issues screen, and the scheduler tries
  // again - see repageStale().
  const told = await alertAdmins({ customer, order, issue });

  if (told.length) {
    const stamp = { paged_at: new Date().toISOString(), paged_to: told };
    const { error: stampError } = await db.from('issues').update(stamp).eq('id', issue.id);
    if (stampError) console.error(`Could not record who was paged: ${stampError.message}`);
    Object.assign(issue, stamp);
  }

  return { issue, isNew: true };
}

// THE OFFICE HEARS ABOUT A PAYMENT HOLD EXACTLY ONCE.
//
// raise() opens at most one issue per customer and returns the existing one
// untouched, which is right for the thing it was built for - the AI getting
// stuck twice in one conversation is one problem, not two. It is wrong for a
// hold, and #2060 is what that looks like: it was already FAILED with an open
// issue on the customer when the hold rule shipped, so markFailed() called
// raise(), raise() found the open row, and nobody was ever paged. An order
// sat holding somebody's laundry with the office believing it had been told.
//
// THREE OUTCOMES, AND THE MIDDLE ONE IS THE POINT:
//
//   no open issue      open one and page, exactly as before
//   open, not a hold   write the hold sentence onto that thread, do NOT page
//   already a hold     do nothing at all
//
// NOT PAGING ON THE SECOND IS DELIBERATE. A person is already being asked to
// look at this customer, and the board redraws every time somebody opens it -
// paging per draw would text every admin all afternoon, which is how an alert
// becomes something people turn off. The sentence lands where they will read
// it, which is the issue they are already holding.
//
// `Payment hold:` IS THE MARKER AND IT IS A PREFIX, not a column. There is no
// issue_kind and this does not add one: the reason text already says what the
// issue is, and the caller writes that sentence.
const HOLD_PREFIX = 'Payment hold:';

async function ensurePaymentHold({ customer, order, reason }) {
  if (!customer || !customer.id) return { ok: false, reason: 'no_customer' };

  const { data: existing, error: findError } = await db
    .from('issues')
    .select('*')
    .eq('customer_id', customer.id)
    .eq('status', 'OPEN')
    .maybeSingle();

  if (findError) throw findError;

  if (!existing) {
    const { issue } = await raise({ customer, order, reason });
    return { ok: true, paged: true, issue };
  }

  // Already says it. Nothing to add and nobody to tell.
  if (String(existing.reason || '').startsWith(HOLD_PREFIX)) {
    return { ok: true, paged: false, named: false, issue: existing };
  }

  // An open issue about something else. The hold goes on the same thread so
  // whoever picks it up sees both, and the original sentence is kept rather
  // than overwritten - it is why somebody was paged in the first place.
  const merged = `${reason}\n\nAlso open: ${existing.reason}`.slice(0, 500);

  const { error } = await db
    .from('issues')
    .update({ reason: merged, order_id: existing.order_id || (order ? order.id : null) })
    .eq('id', existing.id);

  if (error) {
    console.error(`Could not write the payment hold onto issue ${existing.id}: ${error.message}`);
    return { ok: false, reason: 'unwritable' };
  }

  existing.reason = merged;
  return { ok: true, paged: false, named: true, issue: existing };
}

// Text every admin. Best effort: a failure here must never stop the customer
// getting their reply, but it is shouted in the log because a silent failure
// means nobody is coming.
//
// RETURNS WHO WAS TOLD - an empty list when nobody was, for any reason - so the
// caller can write that down. "We texted three people" and "we texted nobody"
// used to look identical from outside this function, and the second one
// happened to a real customer.
//
// `again` is the re-page: same people, same issue, and the message says
// plainly that it is the second time of asking.
async function alertAdmins({ customer, order, issue, again = false }) {
  const who = customer.name || customer.phone;
  const which = order ? ` on order #${order.order_number}` : '';

  const body =
    `${again ? 'STILL WAITING - ' : ''}${site.name} ISSUE${which}: ${who} (${customer.phone}). ` +
    `${issue.reason} ` +
    `Open it at ${config.baseUrl}/ops/issues`;

  try {
    const numbers = await alertRecipients();

    if (!numbers.length) {
      console.error('');
      console.error('  AN ISSUE WAS RAISED AND NOBODY COULD BE TOLD.');
      console.error('  No active admin has a phone number, and SUPPORT_PHONE is unset.');
      console.error(`  ${body}`);
      console.error('');
      return [];
    }

    // Sent to each admin individually, and logged against the customer so the
    // thread shows that somebody was told.
    for (const phone of numbers) {
      await sendAndLog(phone, body, null);
    }

    console.log(
      `ISSUE ${again ? 're-paged' : 'raised'} for ${customer.phone}, ${numbers.length} admin(s) alerted.`
    );
    return numbers;
  } catch (err) {
    console.error('Could not alert admins about an issue:', err.message);
    return [];
  }
}

// --- The re-page --------------------------------------------------------------
//
// A HANDOFF IS A PROMISE, AND ONE TEXT TO AN ADMIN IS NOT KEEPING IT. The AI
// tells the customer a manager will come back to them. If nobody has, that
// promise is being broken in silence - and a single alert that landed at 3am,
// or landed on a phone in a pocket, or never landed at all, is how that
// happens. So the scheduler asks, every tick: is there an open issue older
// than a quarter of an hour that no person has written to the customer about?
// If so, everybody is told once more, and once only.
//
// ONCE ONLY, because a pager that keeps going is a pager that gets muted.
// repaged_at is the stamp; after it, the Issues screen is the reminder.
//
// "A person has written" means an outbound with sent_by on it - typed on the
// ops screen by somebody. A status text or the AI's own reply does not count,
// because neither is the manager the customer was promised.
//
// It runs inside the scheduler tick, which already sits out quiet hours, so a
// handoff at midnight is re-paged at eight. The FIRST page still goes the
// moment the issue is raised, whatever the hour.
const REPAGE_AFTER_MINUTES = 15;

async function personHasWritten(customerId, since) {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('customer_id', customerId)
    .eq('direction', 'OUTBOUND')
    .not('sent_by', 'is', null)
    .gt('created_at', since)
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

async function repageStale() {
  const cutoff = new Date(Date.now() - REPAGE_AFTER_MINUTES * 60_000).toISOString();

  const { data, error } = await db
    .from('issues')
    .select('*, customers(*), orders(order_number)')
    .eq('status', 'OPEN')
    .is('repaged_at', null)
    .lt('created_at', cutoff);

  if (error) throw error;

  const paged = [];

  for (const issue of data || []) {
    const customer = issue.customers;
    if (!customer) continue;

    try {
      if (await personHasWritten(customer.id, issue.created_at)) continue;

      const told = await alertAdmins({ customer, order: issue.orders, issue, again: true });

      // Stamped ONLY when somebody was actually told. If nobody could be, the
      // next tick tries again - and keeps shouting in the log until a team
      // member with a phone exists, which is the right amount of noise for
      // "a customer is waiting on a person and there is no person".
      if (!told.length) continue;

      const stamp = {
        repaged_at: new Date().toISOString(),
        paged_at: issue.paged_at || new Date().toISOString(),
        paged_to: told,
      };
      const { error: stampError } = await db.from('issues').update(stamp).eq('id', issue.id);
      if (stampError) throw stampError;

      paged.push({ issue: issue.id, phone: customer.phone, told: told.length });
    } catch (err) {
      console.error(`Could not re-page issue ${issue.id}: ${err.message}`);
    }
  }

  if (paged.length) console.log(`Re-paged ${paged.length} issue(s) nobody had answered.`);
  return { paged };
}

// Everything still open, newest first, with enough detail to act on.
async function listOpen() {
  const { data, error } = await db
    .from('issues')
    .select('*, customers(id, name, phone), orders(order_number, status)')
    .eq('status', 'OPEN')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// How many are open. Used by every ops page to draw the banner, so it is a
// count rather than a fetch.
async function openCount() {
  const { count, error } = await db
    .from('issues')
    .select('id', { head: true, count: 'exact' })
    .eq('status', 'OPEN');

  if (error) {
    // A broken count must not take the whole dashboard down with it.
    console.error('Could not count open issues:', error.message);
    return 0;
  }

  return count || 0;
}

async function listRecent(limit = 40) {
  const { data, error } = await db
    .from('issues')
    .select('*, customers(id, name, phone), orders(order_number, status), ops_users(name)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// EVERYTHING RAISED ON ONE DAY, open or closed.
//
// listRecent() answers "what is happening" and is capped at the last few dozen,
// which is right for a queue and useless for looking back: an issue from three
// weeks ago falls off it and there is no way to reach it at all. This answers
// "what went on that day" instead.
//
// Bounded on created_at rather than resolved_at, because the day an issue
// HAPPENED is the day you would look for it. One resolved a week later still
// belongs to the day it was raised.
// A DAY IN NEW JERSEY, NOT IN UTC. Railway runs in UTC and New Jersey is four
// or five hours behind it, so a UTC midnight-to-midnight window is not the day
// anybody here means - an issue raised at 9pm on Tuesday is already Wednesday
// in UTC. Same trap as new Date().toISOString() being used for "today".
//
// The query pulls a day either side and the exact boundary is decided in JS by
// asking what LOCAL date each timestamp falls on. That is correct across
// daylight saving without anybody hardcoding an offset that is wrong for half
// the year, and the volume here is a handful of rows.
async function listForDay(dateIso) {
  const wide = (iso, days) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  };

  const { data, error } = await db
    .from('issues')
    .select('*, customers(id, name, phone), orders(order_number, status), ops_users(name)')
    .gte('created_at', wide(dateIso, -1))
    .lte('created_at', wide(dateIso, 1))
    .order('created_at', { ascending: false });

  if (error) throw error;

  // READ HERE, NOT AT THE TOP. booking.js requires order-alerts, which
  // requires this file, so at boot this module is handed booking's exports
  // before booking.js has finished - an empty object for good. SERVICE_TZ read
  // off it was undefined, Intl fell back to the server's zone (UTC on Railway),
  // and anything raised between 8pm and midnight was filed under tomorrow.
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: require('./booking').SERVICE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return (data || []).filter((i) => localDate.format(new Date(i.created_at)) === dateIso);
}

// Close one. Only ever called by a person pressing a button.
async function resolve(issueId, opsUser, resolution) {
  const { data, error } = await db
    .from('issues')
    .update({
      status: 'RESOLVED',
      resolved_at: new Date().toISOString(),
      // The machine key has no person attached, so it resolves as nobody.
      resolved_by: opsUser && !opsUser.isMachine ? opsUser.id : null,
      resolution: resolution ? String(resolution).slice(0, 500) : null,
    })
    .eq('id', issueId)
    .eq('status', 'OPEN')
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data;
}

// --- The hold ---------------------------------------------------------------
//
// Whether a person has taken this conversation over, and whether they are done.

// The open hold for this customer, or null.
async function holdFor(customerId) {
  const { data, error } = await db
    .from('issues')
    .select('id, reason, created_at')
    .eq('customer_id', customerId)
    .eq('status', 'OPEN')
    .eq('ai_hold', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data || [])[0] || null;
}

// aiMustStayQuiet() WAS HERE AND IS GONE TOO, 16 September.
//
// It asked two questions - is there a hold, and has a person written since -
// and answered whether the AI could speak. Neil replaced both with one:
// "If the AI assistant is turned on, then she can reply right away when the
// customer responds. But if the AI assistant is turned off, she should not
// reply at all."
//
// So the gate is aiPause.isPaused() and nothing else, raise() pauses the thread
// on any holding issue, and no code anywhere hands the thread back to Lyn - a
// person does that with the toggle. personHasWritten() survives because the
// re-page sweep still needs it.

// personHasReplied() WAS HERE AND IS GONE. DO NOT PUT IT BACK.
//
// It asked whether ANY outbound had gone since the hold, and its comment
// argued the case: "If some other part of the system has spoken to them since
// - a delivery text, a booking confirmation - the silence is over either way."
//
// That reasoning misses the message that is always first. The very next
// outbound after a handoff is the AI's own "a manager will come back to you
// shortly", so the hold released itself on the customer's next inbound, every
// single time, and the AI carried on talking over the person it had just
// promised them. Manpreet Singh got twenty more AI messages that way.
//
// personHasWritten() above is the question that was always meant: an outbound
// with sent_by on it, typed by somebody. Use that one. A test refuses this name
// coming back.

module.exports = {
  raise,
  ensurePaymentHold,
  HOLD_PREFIX,
  listOpen,
  listRecent,
  openCount,
  resolve,
  alertRecipients,
  listForDay,
  holdFor,
  personHasWritten,
  repageStale,
  REPAGE_AFTER_MINUTES,
};
