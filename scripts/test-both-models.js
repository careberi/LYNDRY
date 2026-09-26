'use strict';

// ---------------------------------------------------------------------------
// RUN THE SUITE UNDER BOTH PRICING MODELS, BECAUSE `npm test` ONLY EVER RAN ONE.
//
// THE SUITE WAS RED UNDER THE MODEL PRODUCTION RUNS AND NOBODY HAD SEEN IT.
// `PRICING_MODEL` decides who does the driving, and it changes real behaviour in
// eight places - the service area, the default carrier, the order minimum, what
// `site.serviceArea` says, whether `/quote` exists. The development `.env` carries
// `DYNAMIC`; production carries nothing, which is `FLAT`. So `npm test` on a
// laptop has only ever tested the courier business, and `test/carriers.test.js`
// had an assertion that relied on a courier being the default - green in
// development, red on the model lyndry.com actually serves, for days.
//
// IT IS NOT A SECOND SUITE AND MUST NEVER BECOME ONE. It is the same 1,293 tests
// twice, with one environment variable different, because the failure it catches
// is exactly "this test quietly assumed which model it was in". A separate set of
// model-specific tests would be a second thing to maintain and would not catch
// that.
//
// WHY A SCRIPT AND NOT TWO CHAINED COMMANDS IN package.json: `PRICING_MODEL=FLAT
// npm test` is not portable to the shell this repo is developed in, and a
// `cross-env` dependency for one line is a dependency. Node spawns both and
// reports which model failed, which is the thing you actually need to know.
// ---------------------------------------------------------------------------

const { spawnSync } = require('node:child_process');

// FLAT FIRST, DELIBERATELY. It is the one production runs, so if you stop reading
// after the first block you have read the one that matters.
const MODELS = [
  { value: 'FLAT', what: 'the van - what lyndry.com serves today' },
  { value: 'DYNAMIC', what: 'couriers - what the development site serves' },
];

const failed = [];

for (const model of MODELS) {
  console.log('');
  console.log(`=== PRICING_MODEL=${model.value} — ${model.what} ===`);

  // THE SAME ARGUMENT `npm test` USES, as one argv element. Node expands the glob
  // itself; handing it the bare directory is a MODULE_NOT_FOUND on this version,
  // and there is no shell here to expand it for us.
  const run = spawnSync(process.execPath, ['--test', 'test/*.test.js'], {
    stdio: 'inherit',
    // The child gets its own copy, so neither run can leak into the other.
    env: { ...process.env, PRICING_MODEL: model.value },
  });

  if (run.status !== 0) failed.push(model.value);
}

console.log('');

if (!failed.length) {
  console.log('Green under both pricing models.');
  process.exit(0);
}

// NAME WHICH ONE, because the same test failing under one model and not the other
// is the whole signal - it means the test assumed a model rather than stating one.
console.error(`FAILED under: ${failed.join(' and ')}.`);
console.error(
  failed.length === 1
    ? 'Green under the other one, which means something assumed which model it was in ' +
        'rather than saying so. Look for a default being relied on - a carrier, a ' +
        'minimum, a service area - not for a broken rule.'
    : 'Failed under both, so it is an ordinary failure rather than a model assumption.'
);
process.exit(1);
