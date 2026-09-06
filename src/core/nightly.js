'use strict';

const { config } = require('../config');
const booking = require('./booking');
const settings = require('./settings');
const recurring = require('./recurring');
const reminders = require('./reminders');

// ---------------------------------------------------------------------------
// THE NIGHTLY PASS, RUN BY THE APP ITSELF.
//
// Two jobs, in this order, once an evening:
//
//   1. Book tomorrow's standing orders, texting those customers as it goes.
//   2. Remind everybody else whose pickup is tomorrow.
//
// The order matters: a standing order booked in step 1 has already been texted
// and recorded as reminded, so step 2 must not text it again.
//
// WHY IT IS NOT A CRON JOB, which is what it was. Neil asked the obvious
// question and he was right. A Railway cron is a second service, configured by
// hand in a dashboard, that nobody had actually set up - so the whole feature
// would have sent nothing at all and looked fine doing it. The web app already
// runs every minute of every day, because an inbound text has to be answered,
// so it can watch the clock itself for nothing.
//
// A POLL, NOT A TIMER. Every few minutes it asks: is it evening, and has today's
// pass already run? A one-shot timer set at startup would be lost by any deploy
// - and a deploy at 5:59pm would silently skip the night. A poll just asks
// again.
//
// QUIET HOURS ARE A HARD STOP, not a preference. Federal rules put marketing
// and service texts inside 8am to 9pm in the recipient's own time. If the app
// was down all evening this pass does NOT catch up at midnight; it says loudly
// that it missed the night and waits. A reminder nobody gets is a bad day. A
// text at 1am is a complaint, a carrier flag, and the kind of thing that gets a
// number shut off.
//
// ONE INSTANCE IS ASSUMED, like the sign-in throttles in admin-auth.js. Two web
// processes would both poll, and the "has tonight run" check is a read then a
// write with nothing locking between them - so both could decide to go. The
// per-order stamps make that mostly harmless (a second pass finds nothing to
// do), but two passes starting in the same second could double-text somebody.
// If this ever runs on more than one replica, that check needs a lock.
//
// SAFE ALONGSIDE THE CRON SCRIPT, if that is ever set up too. Both call
// runPass() and every part of it is idempotent - bookPickup() refuses a second
// pickup for anybody who has one waiting, and orders.reminder_sent_at stops a
// reminder going twice. Whichever runs first does the work.
// ---------------------------------------------------------------------------

// Evening, and inside the legal window. The pass wants to land when somebody is
// home and can act on it: nobody puts a bag out at 6am because they were
// reminded at 6am.
const START_HOUR = Number(process.env.NIGHTLY_HOUR || 18);

// The last hour it may still fire. 21 is 9pm, which is the legal edge, so the
// last possible send is 20:5x.
const LATEST_HOUR = 21;

const POLL_MS = Number(process.env.NIGHTLY_POLL_MINUTES || 10) * 60 * 1000;

// One at a time. A pass that takes longer than the poll interval must not have
// a second one started on top of it.
let running = false;
let timer = null;

// The pass itself. Called by the poll below AND by scripts/cron-recurring.js,
// so there is one implementation of "what happens at night" rather than two
// that drift.
async function runPass({ date = null } = {}) {
  const booked = await recurring.bookDue(date ? { date } : {});
  const reminded = await reminders.sendDue(date ? { date } : {});
  return { booked, reminded };
}

// Should it run right now, and if so, run it.
//
// Returns why it did or did not, so the caller can log something useful rather
// than silence - which is the failure mode this whole file exists to avoid.
// `now` is injectable ONLY so the time-of-day rules can be tested without
// waiting until nine at night. Nothing in the running system passes it.
async function runIfDue({ force = false, now = null } = {}) {
  if (running) return { ran: false, reason: 'already running' };

  const when = now || booking.nowInService();
  const hour = Number(when.time.slice(0, 2));

  if (!force) {
    if (hour < START_HOUR) return { ran: false, reason: 'too early' };

    if (hour >= LATEST_HOUR) {
      // Said loudly rather than swallowed. This is the case where somebody
      // does not get a reminder, and the only way anybody finds out is the log.
      const s = await settings.read({ fresh: true }).catch(() => null);

      if (!s || s.nightly_ran_on !== when.date) {
        console.error('');
        console.error(`  THE NIGHTLY PASS DID NOT RUN ON ${when.date}.`);
        console.error('  It is past 9pm in New Jersey, which is the latest a customer may');
        console.error('  legally be texted, so it will not catch up now. Tomorrow evening');
        console.error("  it runs as normal - but tomorrow's pickups were not reminded.");
        console.error('');
      }

      return { ran: false, reason: 'too late, quiet hours' };
    }
  }

  const current = await settings.read({ fresh: true });
  if (!force && current.nightly_ran_on === when.date) {
    return { ran: false, reason: 'already ran today' };
  }

  running = true;

  try {
    console.log(`NIGHTLY pass starting (${when.date} ${when.time} in New Jersey).`);

    const result = await runPass();

    // STAMPED AFTER, so a crash halfway through retries on the next poll rather
    // than being written off. Retrying is safe: every part of the pass refuses
    // to do the same thing twice.
    await settings.markNightlyRan(when.date);

    console.log(
      `NIGHTLY done: ${result.booked.booked.length} standing order(s) booked, ` +
        `${result.reminded.sent.length} reminder(s) sent.`
    );

    return { ran: true, result };
  } catch (err) {
    // Not stamped, so the next poll tries again. Loud, because a pass that
    // keeps failing is a night of reminders nobody is getting.
    console.error(`NIGHTLY pass failed, will retry on the next poll: ${err.message}`);
    return { ran: false, reason: err.message };
  } finally {
    running = false;
  }
}

// Whether this process should be the one watching the clock.
//
// NOT IN DEVELOPMENT, and this is the important half. The dev server shares the
// production database, so a laptop left running at six in the evening would do
// the whole pass, stamp every order as reminded, and send the texts through the
// fake provider - meaning nothing reaches a phone and production then finds
// nothing left to do. Everybody's reminder would vanish, silently, because
// somebody had a terminal open.
function enabled() {
  const forced = String(process.env.NIGHTLY_ENABLED || '').toLowerCase();
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  return config.env === 'production';
}

// Start watching. Called once, from src/index.js.
function start() {
  if (!enabled()) {
    console.log(
      `  nightly    : off in ${config.env} (set NIGHTLY_ENABLED=true to override)`
    );
    return null;
  }

  console.log(`  nightly    : on, checks every ${Math.round(POLL_MS / 60000)}m after ${START_HOUR}:00 NJ`);

  timer = setInterval(() => {
    runIfDue().catch((err) => console.error(`Nightly poll threw: ${err.message}`));
  }, POLL_MS);

  // Must not be the reason the process stays alive; the HTTP server is.
  if (timer.unref) timer.unref();

  // One check on the way up, so a deploy at 6:30pm does not wait for the first
  // interval before doing the night's work.
  runIfDue().catch((err) => console.error(`Nightly startup check threw: ${err.message}`));

  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runPass, runIfDue, enabled, START_HOUR, LATEST_HOUR };
