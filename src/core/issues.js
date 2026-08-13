'use strict';

const db = require('../db');
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
async function raise({ customer, order, reason, customerSaid }) {
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
    return { issue: existing, isNew: false };
  }

  const { data: issue, error } = await db
    .from('issues')
    .insert({
      customer_id: customer.id,
      order_id: order ? order.id : null,
      reason: String(reason || 'No reason given').slice(0, 500),
      customer_said: customerSaid ? String(customerSaid).slice(0, 500) : null,
    })
    .select('*')
    .single();

  if (error) throw error;

  await alertAdmins({ customer, order, issue });

  return { issue, isNew: true };
}

// Text every admin. Best effort: a failure here must never stop the customer
// getting their reply, but it is shouted in the log because a silent failure
// means nobody is coming.
async function alertAdmins({ customer, order, issue }) {
  const who = customer.name || customer.phone;
  const which = order ? ` on order #${order.order_number}` : '';

  const body =
    `${site.name} ISSUE${which}: ${who} (${customer.phone}). ` +
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
      return;
    }

    // Sent to each admin individually, and logged against the customer so the
    // thread shows that somebody was told.
    for (const phone of numbers) {
      await sendAndLog(phone, body, null);
    }

    console.log(`ISSUE raised for ${customer.phone}, ${numbers.length} admin(s) alerted.`);
  } catch (err) {
    console.error('Could not alert admins about an issue:', err.message);
  }
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

module.exports = { raise, listOpen, listRecent, openCount, resolve, alertRecipients };
