'use strict';

// ---------------------------------------------------------------------------
// A PHOTO OF WHERE THE BAG SITS.
//
// Neil's ask, 16 September: one still photo of the spot, taken with the phone
// camera, stored on the customer rather than the order, shown on the next
// pickup so the driver knows the door - and never texted to anybody.
//
// Most of what is pinned here is the MUST-NOTs, because each one is a way this
// turns into something it was not meant to be:
//
//   on the customer      not burned onto one order, or it is retaken weekly
//                        and the one a new driver needs is on a row nobody
//                        is looking at
//   never texted         it is a note for us about a doorstep, not evidence
//                        for the customer and not a delivery photo
//   never public         no /p/<uuid>, no 30-day window: signed for a minute
//                        off an ops route, for somebody already signed in
//   a still photo        the same mechanism as the bag scan, not a stream
//   never a gate         a driver in the rain is not held up by a camera
//
// Nothing here touches the database, storage or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const spotPhoto = require('../src/core/spot-photo');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

// --- it belongs to the customer ---------------------------------------------

test('IT HANGS OFF THE CUSTOMER, NOT THE ORDER', () => {
  // The whole design. A delivery photo is evidence about one drop-off; this
  // answers "which door", which is true of every pickup they will ever have.
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '0097_pickup_spot_photo.sql'),
    'utf8'
  );

  assert.match(migration, /alter table customers/i, 'the column is not on customers');
  assert.match(migration, /pickup_spot_photo_path/);
  assert.match(migration, /pickup_spot_photo_at/);

  // And nothing was added to orders.
  assert.ok(!/alter table orders/i.test(migration), 'it put a column on orders as well');

  const core = withoutComments(SRC('core', 'spot-photo.js'));
  assert.match(core, /from\('customers'\)/, 'the module does not write to customers');
  assert.ok(!/from\('orders'\)/.test(core), 'the module writes to orders');
});

test('and the run reads it off the customer row it already has', () => {
  const run = withoutComments(SRC('core', 'run.js'));
  const at = run.indexOf('function spotPhotoOf');
  assert.notEqual(at, -1, 'spotPhotoOf has gone');

  const body = run.slice(at, run.indexOf('\n}', at));
  assert.match(body, /order\.customers/, 'it does not read the customer');
  assert.match(body, /pickup_spot_photo_path/);
});

test('THE SELECT LIST CARRIES IT, which is how this kind of thing dies quietly', () => {
  // An unselected column reads as undefined, which is indistinguishable from
  // "no photo" - so the card would simply never draw, on every stop, with
  // nothing failing. That trap has bitten this codebase a dozen times.
  const dispatch = SRC('core', 'dispatch.js');
  const at = dispatch.indexOf('const RUN_FIELDS =');
  assert.notEqual(at, -1, 'RUN_FIELDS has moved');

  const block = dispatch.slice(at, dispatch.indexOf(';', dispatch.indexOf('customers(', at)));
  assert.ok(block.includes('pickup_spot_photo_path'), 'RUN_FIELDS does not select the photo');
  assert.ok(block.includes('pickup_spot_photo_at'), 'RUN_FIELDS does not select when it was taken');
});

// --- it is never sent to anybody --------------------------------------------

test('NOTHING HERE CAN TEXT ANYBODY', () => {
  // Not "does not today" - cannot. The module never imports the one function
  // every outbound message in this system passes through.
  const core = SRC('core', 'spot-photo.js');

  assert.ok(!/sendAndLog|notify|require\('\.\/notify'\)/.test(core), 'the module reached for notify');
  assert.ok(!/messages/.test(withoutComments(core)), 'the module touches the messages table');
});

test('AND IT IS NOT PUBLIC. No /p/ page, no long-lived link', () => {
  // The delivery photo has lyndry.com/p/<order-uuid> precisely because the
  // customer is meant to see it. This one has nothing of the kind.
  const core = withoutComments(SRC('core', 'spot-photo.js'));

  assert.match(core, /createSignedUrl/, 'it does not sign the URL at all');
  assert.ok(!/getPublicUrl/.test(core), 'it hands out a public URL');
  assert.ok(!/'\/p\/'|\/p\/\$\{/.test(core), 'it built a public photo page');

  // A minute, not a day. A URL copied out of an address bar is already dead.
  const at = core.indexOf('SIGNED_SECONDS');
  assert.notEqual(at, -1);
  assert.match(core.slice(at, at + 60), /=\s*60/);

  // The bucket is private by name and by the comment that says so; the
  // migration carries the instruction, since buckets are not schema.
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '0097_pickup_spot_photo.sql'),
    'utf8'
  );
  assert.match(migration, /PRIVATE/i, 'the migration does not say the bucket must be private');
});

test('the routes are keyed off the order, so a driver can reach them', () => {
  // A driver has orders.view and deliberately not customers.view - CLAUDE.md's
  // rule that a driver is shown the stop rather than the person. A
  // customer-scoped URL would 403 on the one screen this exists for.
  const admin = SRC('routes', 'admin.js');

  assert.match(admin, /router\.post\(\s*'\/ops\/orders\/:id\/spot-photo'/, 'no route to take one');
  assert.match(admin, /router\.get\('\/ops\/orders\/:id\/spot-photo'/, 'no route to look at one');

  assert.ok(
    !/\/ops\/customers\/:id\/spot-photo/.test(admin),
    'it added a customer-scoped URL a driver cannot open'
  );

  // Taking one is a step in the round; looking is reading the stop.
  const post = admin.slice(admin.indexOf("router.post(\n  '/ops/orders/:id/spot-photo'"), admin.indexOf("router.get('/ops/orders/:id/spot-photo'"));
  assert.match(post, /may\('orders\.act'\)/);

  const get = admin.slice(admin.indexOf("router.get('/ops/orders/:id/spot-photo'"));
  assert.match(get.slice(0, 200), /may\('orders\.view'\)/);
  // The whole handler, not a guessed window: the no-store line is the last
  // thing before the redirect and a short slice cuts it off.
  assert.match(get.slice(0, get.indexOf('\n});')), /no-store, private/, 'the image response is cacheable');
});

// --- a still photo, and never a gate ----------------------------------------

test('IT IS A STILL PHOTO, THE SAME MECHANISM AS THE BAG SCAN', () => {
  // A file input with capture="environment" opens the phone's own camera -
  // autofocus, exposure, torch - with no live stream to keep alive.
  const page = SRC('web', 'run-page.js');
  const at = page.indexOf("task.key === 'collected'");
  assert.notEqual(at, -1, 'the collect control has moved');

  const block = page.slice(at, page.indexOf("task.key === 'van'", at));

  assert.match(block, /capture="environment"/, 'it does not open the camera');
  assert.match(block, /type="file"/, 'it is not a file input');
  assert.match(block, /enctype="multipart\/form-data"/);

  // No live video anywhere near it.
  assert.ok(!/getUserMedia|<video/.test(block), 'it opened a video stream');
});

test('AND NOTHING IS GATED ON IT', () => {
  // A note for the next driver, not evidence. The collect button does not care
  // whether a photo exists, and a driver in the rain is not held up by one.
  const page = SRC('web', 'run-page.js');
  const at = page.indexOf("task.key === 'collected'");
  const block = page.slice(at, page.indexOf("task.key === 'van'", at));

  // The collect form is its own form and carries no file.
  const collectForm = block.slice(block.indexOf('/collected'));
  assert.ok(!/enctype/.test(collectForm.slice(0, 200)), 'the collect button now posts a file');

  // And the run never blocks a task on it.
  const run = withoutComments(SRC('core', 'run.js'));
  assert.ok(!/blockedBy: 'spot/.test(run), 'a step is now blocked on the photo');

  // fulfilment.collect() has not learned about it either.
  const fulfilment = withoutComments(SRC('core', 'fulfilment.js'));
  assert.ok(!/spot_photo/.test(fulfilment), 'collecting now depends on the photo');
});

// --- what the module refuses ------------------------------------------------

test('it refuses an empty upload rather than blanking what is there', () => {
  // Async, but these two return before any database or storage call.
  return Promise.all([
    spotPhoto.save('c1', null).then((r) => {
      assert.equal(r.ok, false);
      assert.match(r.detail, /No photo/);
    }),
    spotPhoto.save('c1', { buffer: Buffer.alloc(0) }).then((r) => {
      assert.equal(r.ok, false);
    }),
    spotPhoto.save(null, { buffer: Buffer.from('x') }).then((r) => {
      assert.equal(r.ok, false);
      assert.match(r.detail, /No customer/);
    }),
  ]);
});

test('and it refuses something that is not a photo', async () => {
  const r = await spotPhoto.save('c1', {
    buffer: Buffer.from('not an image'),
    mimetype: 'application/pdf',
  });

  assert.equal(r.ok, false);
  assert.match(r.detail, /not a photo/);
});

test('has() answers false for a customer with nothing, and never throws', () => {
  assert.equal(spotPhoto.has(null), false);
  assert.equal(spotPhoto.has({}), false);
  assert.equal(spotPhoto.has({ pickup_spot_photo_path: null }), false);
  assert.equal(spotPhoto.has({ pickup_spot_photo_path: 'c1/spot.jpg' }), true);
});

test('signedUrl(null) is null rather than an error', async () => {
  // "No photo" is the ordinary state for every customer who has never had one.
  assert.equal(await spotPhoto.signedUrl(null), null);
});
