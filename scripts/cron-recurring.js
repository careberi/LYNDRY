'use strict';

// ---------------------------------------------------------------------------
// Book tomorrow's standing orders. Run once a day.
//
// A customer who says "same time every week" has a schedule stored against
// them, and something has to actually look at those schedules and book the
// pickups. This is that something. Without it a standing order is a promise
// nobody keeps: the customer is told it is all arranged and then their laundry
// is simply never collected.
//
// WHY A SCRIPT AND NOT A TIMER INSIDE THE SERVER. Railway's scheduler starts a
// service, waits for it to exit, and bills for the seconds it ran. So this has
// to be a thing that runs, does one pass and stops - not a web server that
// happens to check the clock. It also means the pass is visible in Railway's
// logs as its own run, rather than buried in the web app's output.
//
// It calls the booking code directly rather than making an HTTP request to
// /ops/cron/recurring. Same repository, same environment variables, same
// database - going out to the internet and back to reach our own function
// would only add a URL and an admin key that could be wrong.
//
// SAFE TO RUN TWICE, OR TEN TIMES, OR AT ANY HOUR. bookPickup refuses a second
// pickup for anybody who already has one waiting, so a double fire is a no-op
// rather than a double booking and a double charge. That matters because a
// scheduler that retries is a scheduler you do not have to think about.
//
//   npm run cron:recurring              book for tomorrow
//   npm run cron:recurring -- 2026-08-20   book for a named day, for testing
// ---------------------------------------------------------------------------

const recurring = require('../src/core/recurring');
const booking = require('../src/core/booking');

async function main() {
  // A date can be passed in to test a specific day. Without one it does
  // tomorrow, which is the point: the warning text lands the evening before.
  const date = process.argv[2] || null;

  console.log('');
  console.log(`  Standing orders - it is ${booking.nowInService().date} ${booking.nowInService().time} in New Jersey`);

  const result = await recurring.bookDue(date ? { date } : {});

  console.log('');
  console.log(`  Booking for ${result.date}`);

  if (result.booked.length) {
    for (const order of result.booked) {
      console.log(`    booked  #${order.order_number}`);
    }
  } else {
    console.log('    nothing due');
  }

  // Anything that could not be booked, and why. A customer whose card died
  // has to show up here rather than silently stop getting laundry, so these
  // are printed even though the run is still counted a success - the pass
  // worked, it is the individual booking that did not.
  for (const failure of result.failed) {
    console.log(`    NOT booked  ${failure.customer.phone}  (${failure.reason})`);
  }

  console.log('');
  console.log(`  ${result.booked.length} booked, ${result.failed.length} not.`);
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // A non-zero exit is what makes the run show as failed in Railway rather
    // than as a green tick over a pass that never happened.
    console.error('');
    console.error('  The standing-order pass failed:', err.message);
    console.error('');
    process.exit(1);
  });
