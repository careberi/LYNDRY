'use strict';

const { config } = require('../config');
const booking = require('./booking');
const nightly = require('./nightly');
const followups = require('./followups');

// ---------------------------------------------------------------------------
// THE ONE CLOCK. Everything that happens without somebody pressing a button.
//
// Two jobs on one ten-minute tick:
//
//   the nightly pass   once an evening: book tomorrow's standing orders, then
//                      remind everybody whose pickup is tomorrow.
//   follow-ups         all day: chase anybody the AI asked a question a day
//                      ago who never answered.
//
// They are separate modules because they are separate decisions; the timer is
// here because there should be one, and because "what runs by itself" is a
// question somebody should be able to answer by opening a single file.
//
// This replaced a Railway cron service, at Neil's prompting. A cron is a second
// thing to configure by hand in a dashboard, and the one this system had was
// never actually set up - so the work simply never happened and nothing said
// so. The web app is already running every minute of every day, because an
// inbound text has to be answered, so it can watch the clock for free.
//
// QUIET HOURS ARE A HARD FLOOR ON BOTH JOBS. Federal rules put texts inside
// 8am to 9pm in the recipient's own time, and everything here is unprompted -
// nobody has just texted us and is waiting. Late is not a reason to send at
// midnight.
//
// A NOTE ON THE DIFFERENCE BETWEEN THEM, because it matters:
//
//   The nightly pass SKIPS a night it missed. Its message says "tomorrow", so
//   sending it at 6am the next day would be a lie.
//   A follow-up DEFERS. It is simply "a day or so later", so one that came due
//   at 3am goes out at 8am and is still exactly right.
// ---------------------------------------------------------------------------

// The earliest and latest a customer may be texted, in New Jersey. Not
// configurable: this is the law, not a preference.
const QUIET_START = 8;
const QUIET_END = 21;

const POLL_MS = Number(process.env.SCHEDULER_POLL_MINUTES || 10) * 60 * 1000;

let timer = null;
let ticking = false;

// Whether this process should be the one watching the clock.
//
// NOT IN DEVELOPMENT, and this is the important half. The dev server shares the
// production database, so a laptop left running in the evening would do the
// whole nightly pass, stamp every order as reminded, and send the texts through
// the fake provider - meaning nothing reaches a phone and production then finds
// nothing left to do. Everybody's reminder would vanish, silently, because
// somebody had a terminal open.
function enabled() {
  const forced = String(process.env.NIGHTLY_ENABLED || '').toLowerCase();
  if (forced === 'true') return true;
  if (forced === 'false') return false;
  return config.env === 'production';
}

function inQuietHours(when) {
  const hour = Number(when.time.slice(0, 2));
  return hour < QUIET_START || hour >= QUIET_END;
}

// One pass of everything. Exported so it can be run by hand and tested.
async function tick({ now = null } = {}) {
  if (ticking) return { skipped: 'already ticking' };
  ticking = true;

  const when = now || booking.nowInService();
  const done = {};

  try {
    // Nothing unprompted goes out at night. Both jobs are silent until 8am.
    if (inQuietHours(when)) return { quiet: true };

    done.nightly = await nightly
      .runIfDue({ now: when })
      .catch((err) => ({ ran: false, reason: err.message }));

    done.followups = await followups
      .sendDue()
      .catch((err) => ({ sent: [], skipped: [{ reason: err.message }] }));

    return done;
  } finally {
    ticking = false;
  }
}

function start() {
  if (!enabled()) {
    console.log(`  scheduler  : off in ${config.env} (set NIGHTLY_ENABLED=true to override)`);
    return null;
  }

  console.log(
    `  scheduler  : on, every ${Math.round(POLL_MS / 60000)}m between ` +
      `${QUIET_START}:00 and ${QUIET_END}:00 NJ`
  );

  timer = setInterval(() => {
    tick().catch((err) => console.error(`Scheduler tick threw: ${err.message}`));
  }, POLL_MS);

  // Must not be the reason the process stays alive; the HTTP server is.
  if (timer.unref) timer.unref();

  // One pass on the way up, so a deploy in the middle of the evening does not
  // wait ten minutes before doing the night's work.
  tick().catch((err) => console.error(`Scheduler startup tick threw: ${err.message}`));

  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, enabled, inQuietHours, QUIET_START, QUIET_END };
