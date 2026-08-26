'use strict';

const db = require('../db');

// ---------------------------------------------------------------------------
// The switches that change how the service behaves right now.
//
// One row in `app_settings`, and one job: is the service taking orders, and if
// not, what does Neil want people told.
//
// CACHED FOR A FEW SECONDS, NOT FOR THE PROCESS LIFETIME. Every inbound text
// reads this, so hitting the database each time is waste; but a switch nobody
// can turn off without a redeploy is not a switch. Ten seconds is short enough
// that flipping it feels immediate and long enough that a busy minute does not
// hammer the table.
// ---------------------------------------------------------------------------

const CACHE_MS = 10 * 1000;

const DEFAULTS = Object.freeze({
  taking_orders: true,
  paused_reason: null,
});

let cached = null;
let cachedAt = 0;

async function read({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;

  const { data, error } = await db
    .from('app_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle();

  if (error) {
    // A settings table having a bad day must not take the service down, and
    // the safe default is OPEN: refusing every order because a read failed
    // would be a worse outage than the one we are handling.
    console.error('Could not read app_settings:', error.message);
    return cached || { ...DEFAULTS };
  }

  cached = data || { ...DEFAULTS };
  cachedAt = Date.now();
  return cached;
}

// Are we booking?
async function takingOrders() {
  const s = await read();
  return s.taking_orders !== false;
}

// Why we are not, as a sentence, or null.
async function pausedReason() {
  const s = await read();
  return s.taking_orders === false ? s.paused_reason || null : null;
}

// Flip it. `reason` is only kept when switching OFF - Neil's call, and it is
// the right one: being open needs no explanation, and a stale reason left
// lying around would surface the next time somebody paused without typing one.
async function setTakingOrders(taking, reason, opsUserId) {
  const { data, error } = await db
    .from('app_settings')
    .update({
      taking_orders: Boolean(taking),
      paused_reason: taking ? null : String(reason || '').trim().slice(0, 300) || null,
      updated_at: new Date().toISOString(),
      updated_by: opsUserId || null,
    })
    .eq('id', true)
    .select('*')
    .maybeSingle();

  if (error) throw error;

  cached = data;
  cachedAt = Date.now();
  return data;
}

module.exports = { read, takingOrders, pausedReason, setTakingOrders, CACHE_MS };
