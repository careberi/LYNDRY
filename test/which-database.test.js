'use strict';

// ---------------------------------------------------------------------------
// THE CONNECTION KNOWS WHICH DATABASE IT IS, AND REFUSES THE WRONG ONE.
//
// Until 25 September nothing here did. A dozen places asked "am I in
// production" and every one guarded a timer or a tracking pixel, never the
// rows - so a laptop was a fully privileged production node kept honest only by
// whoever was typing remembering which .env was in place.
//
// That failed once already. Order #2073: a sandbox Stripe key met a live card,
// Stripe answered "No such PaymentMethod", and the system recorded it as the
// CUSTOMER'S card being refused - a fact about a laptop, written onto a real
// order, which took the stop off the round.
//
// THE RULE IS A POSITIVE MATCH IN ONE DIRECTION ONLY. "This IS production AND
// this is NOT production" refuses. "I do not recognise this project" does not -
// because the day somebody restores production into a fresh project, a guard
// written the other way round would refuse to boot the real server, and the
// safety net would be the outage.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { config } = require('../src/config');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

// The rule as db.js states it, read rather than re-implemented - a second copy
// here could agree with itself while disagreeing with the file that runs.
const GUARD = /config\.supabase\.isProduction && config\.env !== 'production' && !config\.live/;

test('THE GUARD IS STILL THERE, AND STILL THE RIGHT WAY ROUND', () => {
  const db = SRC('db.js');

  assert.match(db, GUARD, 'the production-database refusal has gone or changed shape');
  assert.ok(
    !/!config\.supabase\.isProduction/.test(db),
    'the guard refuses on NOT recognising a project, which would break a restored production'
  );
  // The refusal must come before the client is BUILT, not merely before the
  // import of createClient at the top of the file - which is what the first
  // version of this assertion actually compared, and it passed for free.
  const refusal = db.indexOf('REFUSED: this is the PRODUCTION database');
  const built = db.indexOf('createClient(config.supabase.url');

  assert.ok(refusal !== -1, 'the refusal message has gone');
  assert.ok(built !== -1, 'the client is no longer built from config.supabase.url');
  assert.ok(refusal < built, 'the connection is opened before the guard can refuse it');
});

test('WHICH DATABASE IS READ OFF THE URL, NEVER DECLARED BESIDE IT', () => {
  // Two fields saying where you are is the drift this exists to stop: the copy
  // that disagreed would be the one nobody checked.
  const cfg = SRC('config.js');

  assert.match(cfg, /projectRef: supabaseProjectRef/, 'the project ref stopped coming from the URL');
  assert.match(cfg, /supabaseProjectRef === PRODUCTION_PROJECT_REF/, 'the comparison has moved');
  assert.ok(
    !/isProduction:\s*process\.env/.test(cfg),
    'whether this is production is being read from a variable somebody can set'
  );
});

test('AND config.env IS NOT THE SAME QUESTION', () => {
  // config.env answers "how should this behave". config.supabase.isProduction
  // answers "are these rows real customers". Collapsing them is the bug.
  assert.equal(typeof config.env, 'string');
  assert.equal(typeof config.supabase.isProduction, 'boolean');
  assert.equal(typeof config.supabase.projectRef, 'string');
});

test('THE WAY THROUGH IS AN ARGUMENT, SO IT CANNOT BE LEFT LYING AROUND', () => {
  // A variable would be pasted into .env "just for now" and stay there, which
  // undoes the guard silently and looks fine. An argument has to be typed every
  // time and shows up in the command afterwards.
  const cfg = SRC('config.js');

  assert.match(cfg, /const LIVE = process\.argv\.includes\('--live'\)/, 'the --live flag has moved');
  assert.ok(
    !/process\.env\.(LIVE|ALLOW_PRODUCTION|FORCE_PRODUCTION)/.test(cfg),
    'the escape hatch became an environment variable, which can live in a file'
  );
});

test('AND .env IS THE DEVELOPMENT ONE, SO THE DEFAULT IS THE SAFE ONE', () => {
  const cfg = SRC('config.js');
  assert.match(
    cfg,
    /LIVE \? '\.env\.production\.local' : '\.env'/,
    'the default env file is no longer the development one'
  );
});

test('THE PRODUCTION PROJECT IS RECOGNISED WITH OR WITHOUT THE PROTOCOL', () => {
  // A hosting dashboard shows a Supabase URL with no "https://" on the front,
  // and APP_BASE_URL has already been set that way once - there is a whole
  // function below it in config.js putting the protocol back.
  //
  // If that happened to SUPABASE_URL on production, projectRefOf() would return
  // nothing, isProduction would read FALSE on the live server, and the
  // development band would render across the top of lyndry.com.
  const { projectRefOf, PRODUCTION_PROJECT_REF } = require('../src/config');
  const ref = PRODUCTION_PROJECT_REF;

  for (const shape of [
    `https://${ref}.supabase.co`,
    `http://${ref}.supabase.co`,
    `${ref}.supabase.co`,
    `  https://${ref}.supabase.co  `,
    `https://${ref}.supabase.co/`,
  ]) {
    assert.equal(projectRefOf(shape), ref, `not recognised: ${JSON.stringify(shape)}`);
  }

  // And nothing else is mistaken for it.
  assert.equal(projectRefOf(''), '');
  assert.equal(projectRefOf('https://example.com'), '');
  assert.notEqual(projectRefOf('https://psrphpgbiifvnlrgvbdg.supabase.co'), ref);
});

test('every script that acts describes where it is pointed', () => {
  // One implementation, so a script cannot describe the target differently
  // from the server's own boot banner.
  assert.equal(typeof require('../src/config').describeTarget, 'function');

  for (const script of ['seed.js', 'migrate.js']) {
    const src = fs
      .readFileSync(path.join(__dirname, '..', 'scripts', script), 'utf8');
    assert.match(src, /describeTarget\(\)/, `${script} does not say which database it is about to touch`);
  }
});
