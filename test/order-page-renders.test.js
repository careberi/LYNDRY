'use strict';

// ---------------------------------------------------------------------------
// THE MANUAL BOOKING PAGE RENDERS ITS CONTROLS. RUN, NOT GREPPED.
//
// Neil, 17 September, on /ops/customers/<id>/order: "The manual booking page
// currently gives me nothing usable to interact with... I already know it
// exists in the source. The bug is that the page I actually receive is not
// usable."
//
// WHAT WAS WRONG: a comment inside phoneOrderForm() contained backticks.
//
//     <!-- ... when nothing is set, so `|| 'not set'` could never fire ... -->
//
// That comment lives inside the function's template literal, so the first
// backtick ENDED THE STRING. What JavaScript then read was:
//
//     return `<html up to "so ">` || 'not set' ` ...the rest of the page... `
//
// which is a string OR a tagged template. The left side is a non-empty string,
// so it is truthy, so the whole expression short-circuits and returns it -
// and the tagged template on the right is never evaluated, so it never throws
// "not set is not a function" either.
//
// The function returned 605 characters instead of 2596. The page answered 200,
// carried its nav, its heading and half of one card, and then simply stopped:
// no date field, no time field, no notes, no Book it and text them, no </form>.
// Nothing logged, nothing threw, and every test passed.
//
// SO THIS TEST RUNS THE PAGE. It stubs the database and the sign-in check,
// mounts the REAL router on a real server, makes a REAL request, and reads what
// comes back over the wire. A test that searches admin.js for "pickup_date"
// would have passed on the broken build - the string was there the whole time,
// two characters after the point where the return value stopped.
//
// It writes nothing and sends nothing: one GET, a fake database, and a
// passthrough where the sign-in check goes.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const CUSTOMER = {
  id: '3602abb5-cf7e-4916-80fc-b77dd88a99aa',
  name: 'Test Fixture',
  phone: '+12015550123',
  status: 'ACTIVE',
  address_line1: '25 Main St',
  address_line2: null,
  city: 'Fair Lawn',
  state: 'NJ',
  postal_code: '07410',
  preferences: { water_temp: 'WARM', fabric_softener: 'NONE', special_instructions: 'front porch' },
  default_payment_method_id: 'pm_1',
  card_brand: 'visa',
  card_last4: '4242',
};

// Enough of the Supabase query builder for this one handler: a chainable object
// that hands back the fixture. Nothing here can reach a real database - `db` is
// replaced before admin.js is ever required.
function fakeDb() {
  const builder = (table) => {
    const result = table === 'customers' ? { data: CUSTOMER, error: null } : { data: null, error: null };
    const chain = new Proxy(
      {
        single: async () => result,
        maybeSingle: async () => result,
        then: (resolve, reject) =>
          Promise.resolve({ data: result.data ? [result.data] : [], error: null }).then(resolve, reject),
      },
      {
        get: (target, prop) => (prop in target ? target[prop] : () => chain),
      }
    );
    return chain;
  };

  return { from: builder };
}

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

// The page, fetched over HTTP from the real router.
async function fetchOrderPage() {
  stub(path.join(ROOT, 'src', 'db.js'), fakeDb());

  // The sign-in check is not what is on trial. A passthrough that puts an Admin
  // on the request, so the render runs exactly as it does for a signed-in
  // owner - which is the path that was broken.
  const realAuth = require(path.join(ROOT, 'src', 'core', 'admin-auth.js'));
  stub(path.join(ROOT, 'src', 'core', 'admin-auth.js'), {
    ...realAuth,
    requireAdminPage: (req, res, next) => {
      req.opsUser = {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        drives: false,
      };
      next();
    },
  });

  const express = require('express');
  const { router } = require(path.join(ROOT, 'src', 'routes', 'admin.js'));

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(router);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    return await new Promise((resolve, reject) => {
      http
        .get(
          { host: '127.0.0.1', port: server.address().port, path: `/ops/customers/${CUSTOMER.id}/order` },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode, body }));
          }
        )
        .on('error', reject);
    });
  } finally {
    server.close();
  }
}

let page;

test('the page is fetched once, over HTTP, from the real router', async () => {
  page = await fetchOrderPage();

  assert.equal(page.status, 200, `the booking page answered ${page.status}`);
  assert.ok(page.body.length > 2000, `only ${page.body.length} bytes came back`);
});

// --- the controls, in what actually arrived ----------------------------------

test('THE FORM IS ON THE PAGE, AND IT POSTS WHERE IT ALWAYS DID', () => {
  assert.match(
    page.body,
    new RegExp(`<form method="post" action="/ops/customers/${CUSTOMER.id}/order"`),
    'the booking form is not in the page that was served'
  );

  // The closing tag is half the point: the fault truncated the return value, so
  // an opening tag with no closing one is exactly what a half-rendered page
  // looks like.
  assert.ok(page.body.includes('</form>'), 'the form is opened and never closed');
});

test('the pickup date is there, and it is a real date control', () => {
  assert.match(page.body, /<input[^>]*id="pickup_date"[^>]*name="pickup_date"[^>]*type="date"/);
  assert.ok(!/id="pickup_date"[^>]*disabled/.test(page.body), 'the date field is disabled');
  assert.ok(!/id="pickup_date"[^>]*readonly/.test(page.body), 'the date field is read only');
});

test('the pickup time is there, and it is a real time control', () => {
  assert.match(page.body, /<input[^>]*id="pickup_time"[^>]*name="pickup_time"[^>]*type="time"/);
  assert.ok(!/id="pickup_time"[^>]*disabled/.test(page.body), 'the time field is disabled');
});

test('BOOK IT AND TEXT THEM IS ON THE PAGE, AND IT SUBMITS', () => {
  assert.ok(page.body.includes('Book it and text them'), 'the submit button never reached the page');

  const button = page.body.match(/<button[^>]*>\s*Book it and text them\s*<\/button>/);
  assert.ok(button, 'the words are on the page but not on a button');
  assert.match(button[0], /type="submit"/, 'the button does not submit');
  assert.ok(!/disabled/.test(button[0]), 'the button is disabled');
});

test('the form closes after the button, so nothing is cut off at the end', () => {
  const submit = page.body.indexOf('Book it and text them');
  const closes = page.body.indexOf('</form>', submit);

  assert.ok(submit > 0 && closes > submit, 'the page stops before the form is finished');
  assert.ok(page.body.indexOf('</main>') > closes, 'the form is not inside the page body');
});

test('what it tells you about the customer is there too', () => {
  // The card above the form. It was the half that DID survive the truncation,
  // which is what made the page look rendered rather than broken.
  assert.ok(page.body.includes('What we already have'), 'the summary card is gone');
  assert.ok(page.body.includes('25 Main St'), 'the address is not shown');
  assert.ok(page.body.includes('front porch'), 'the bag spot is not shown');
  assert.ok(page.body.includes('ending 4242'), 'the card on file is not shown');
});

// --- the fault itself, so it cannot come back --------------------------------

test('NO HTML COMMENT ANYWHERE IN src/ CONTAINS A BACKTICK', () => {
  // The general form of the bug. These comments sit inside template literals,
  // where a backtick is not punctuation - it ends the string, silently, and
  // takes the rest of the page with it. There is no reason to want one.
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        // JAVASCRIPT COMMENTS ARE STRIPPED FIRST, and that is not a loophole:
        // a backtick in a // or /* */ comment is genuinely harmless, and the
        // note above phoneOrderForm() quotes the broken line on purpose so the
        // next person can see what it looked like. What is dangerous is an
        // HTML comment sitting in string content, which is what is left.
        const src = fs
          .readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n')
          .filter((line) => !/^\s*\/\//.test(line))
          .join('\n');

        for (const match of src.matchAll(/<!--[\s\S]*?-->/g)) {
          if (match[0].includes('`')) {
            offenders.push(`${path.relative(ROOT, full)}: ${match[0].slice(0, 70).replace(/\s+/g, ' ')}`);
          }
        }
      }
    }
  };

  walk(path.join(ROOT, 'src'));

  assert.deepEqual(offenders, [], `a backtick inside an HTML comment ends the template literal:\n${offenders.join('\n')}`);
});

test('phoneOrderForm returns the whole page, not the first paragraph of it', () => {
  // Measured rather than matched. The broken version returned 605 characters
  // and every string this test looks for was still present in the SOURCE - it
  // simply never reached the page.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'admin.js'), 'utf8');
  const body = src.slice(
    src.indexOf('function phoneOrderForm('),
    src.indexOf("router.get('/ops/customers/:id/order'")
  );

  const build = new Function(
    'escapeHtml',
    'wash',
    'booking',
    'formatPhone',
    'phoneBanner',
    `${body}; return phoneOrderForm;`
  )(
    require('../src/web/layout').escapeHtml,
    require('../src/core/wash'),
    require('../src/core/booking'),
    (p) => p,
    () => ''
  );

  const html = build({ customer: { id: 'x', name: 'Test', phone: '+12015550123', preferences: {} } });

  assert.ok(html.length > 2000, `it returned ${html.length} characters`);
  assert.ok(html.trimEnd().endsWith('</form>'), `it ends with: ${JSON.stringify(html.slice(-40))}`);
});

// --- and nothing about how a booking works changed ---------------------------

test('the page still asks for a day and a time and decides nothing itself', () => {
  // "This is deliberately thin. Everything that decides whether a pickup can
  // happen lives in booking.checkSlot(), and bookPickup() runs it again before
  // it writes." The fix was a comment; none of that moved.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'admin.js'), 'utf8');
  const post = src.slice(src.indexOf("router.post('/ops/customers/:id/order'"));
  const handler = post.slice(0, post.indexOf('\nrouter.'));

  assert.ok(handler.includes('booking.bookPickup('), 'the POST no longer goes through bookPickup()');
  assert.ok(!/PICKUP_WINDOWS/.test(handler), 'the route has started working out windows itself');
  assert.ok(!/inServiceArea/.test(handler), 'the route has started deciding the service area itself');
});

test('the windows it names come from booking.js, not from the page', () => {
  const booking = require('../src/core/booking');
  assert.ok(page.body.includes(booking.listWindows()), 'the window list is typed into the page');
});
