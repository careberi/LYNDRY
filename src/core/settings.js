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

// THE WEIGHT THRESHOLDS, as the comparison code wants them. Read through here
// so there is one place that knows the column names and one place that knows
// what to do when the row cannot be read.
async function weightLimits() {
  const row = await read();
  return {
    normalPct: Number(row.weight_normal_pct != null ? row.weight_normal_pct : 3),
    acceptablePct: Number(row.weight_acceptable_pct != null ? row.weight_acceptable_pct : 5),
    minLb: Number(row.weight_min_lb != null ? row.weight_min_lb : 2),
  };
}

// Set the three weight thresholds. Clamped rather than validated-and-refused:
// a percentage of 0 or 900 is a typo, not an attack, and quietly holding it to
// something sane beats a red error a busy person has to read.
async function setWeightLimits({ normalPct, acceptablePct, minLb }, opsUserId = null) {
  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  };

  const normal = clamp(normalPct, 0, 50, 3);

  const row = {
    weight_normal_pct: normal,
    // THE ACCEPTABLE BAND CANNOT SIT BELOW THE NORMAL ONE. If it did, the
    // middle band would be empty and every order past normal would go straight
    // to exception - which is the two-band behaviour this replaced, arrived at
    // by accident rather than on purpose.
    weight_acceptable_pct: Math.max(normal, clamp(acceptablePct, 0, 50, 5)),
    weight_min_lb: clamp(minLb, 0, 20, 2),
    updated_at: new Date().toISOString(),
    updated_by: opsUserId,
  };

  const { error } = await db.from('app_settings').update(row).eq('id', true);
  if (error) throw error;

  cached = null;
  return row;
}

module.exports = {
  weightLimits,
  setWeightLimits, read, takingOrders, pausedReason, setTakingOrders, CACHE_MS };
