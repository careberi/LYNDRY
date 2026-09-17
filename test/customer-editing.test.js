'use strict';

// ---------------------------------------------------------------------------
// THE CUSTOMER PAGE: ONE OPT-OUT BUTTON, AND EDIT ON TWO CARDS.
//
// Neil, 17 September:
//
//   "Opt-out. If they can be texted: one button, Opt out of texts. If they are
//    opted out: Opted out of texts, plus Opt back in. No essay. No 'how they
//    told you' box. STOP from their phone still opts them out. Opt back in from
//    ops is allowed when I press the button."
//
//   "Edit. On Details and Wash Preferences, add Edit. I can change address and
//    wash: temperature, detergent, softener, usual pickup, instructions. Save
//    writes the customer row. Cancel leaves it as it was."
//
// TWO OF THESE REVERSE RULES THIS CODEBASE HELD, and both reversals are his:
// opting somebody back in from ops, and being able to set a detergent. What the
// tests below hold is the part that did not change - that nothing here
// manufactures a consent record, and that detergent is still never asked of a
// customer.
//
// Nothing here touches the database or the network.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const wash = require('../src/core/wash');
const booking = require('../src/core/booking');
const compliance = require('../src/core/compliance');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
    .join('\n');

// The module-level helpers, lifted out and run on their own. admin.js needs a
// database to require, and these two functions do not.
function helpers() {
  const src = SRC('routes', 'admin.js');

  const washForm = src.slice(
    src.indexOf('function washForm('),
    src.indexOf('// ONE BUTTON, AND THE OTHER ONE WHEN IT APPLIES.')
  );
  const optOut = src.slice(
    src.indexOf('function optOutControl('),
    src.indexOf('// CALLING A PICKUP OFF, FROM THIS END.')
  );

  assert.ok(washForm && optOut, 'one of the helpers has moved');

  const { escapeHtml } = require('../src/web/layout');
  return new Function(
    'escapeHtml',
    'wash',
    'booking',
    `${washForm}${optOut}; return { washForm, optOutControl };`
  )(escapeHtml, wash, booking);
}

const { washForm, optOutControl } = helpers();

const PERSON = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Sharish Khan',
  status: 'ACTIVE',
};

const ROUTE = (name) => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const from = src.indexOf(`router.post('/ops/customers/:id/${name}'`);
  assert.ok(from > 0, `the ${name} route is gone`);
  return src.slice(from, src.indexOf('\nrouter.', from + 10));
};

// --- one button ---------------------------------------------------------------

test('somebody who can be texted gets one button and no form to fill in', () => {
  const html = optOutControl(PERSON, true);

  assert.match(html, />Opt out of texts</);
  assert.ok(!/<input/.test(html), 'there is still a box to type into');
  assert.ok(!/<textarea/.test(html), 'there is still a box to type into');
  assert.equal((html.match(/<button/g) || []).length, 1, 'more than one button');
});

test('the essay is gone', () => {
  // Four lines explaining what opting out stops, and a required "how they told
  // you" field. Every line of it was true and the whole thing was in the way:
  // this control gets reached for with somebody on the phone asking to be left
  // alone.
  const html = optOutControl(PERSON, true);

  assert.ok(!/How they told you/i.test(html), 'the note box came back');
  assert.ok(!/reminders, offers, status texts/i.test(html), 'the essay came back');
  assert.ok(html.length < 700, `still ${html.length} characters of it`);
});

test('an opted-out number says so, and offers the way back', () => {
  const html = optOutControl({ ...PERSON, status: 'UNSUBSCRIBED' }, true);

  assert.match(html, />Opted out of texts</);
  assert.match(html, />Opt back in</);
  assert.match(html, /\/opt-in"/);
});

test('the two states never show each other', () => {
  assert.ok(!/opt-in/.test(optOutControl(PERSON, true)), 'an active customer is offered opt back in');
  assert.ok(
    !/>Opt out of texts</.test(optOutControl({ ...PERSON, status: 'UNSUBSCRIBED' }, true)),
    'an opted-out customer is offered opting out again'
  );
});

test('somebody without the permission gets neither', () => {
  assert.equal(optOutControl(PERSON, false), '');
  assert.equal(optOutControl({ ...PERSON, status: 'UNSUBSCRIBED' }, false), '');
});

test("a customer's own name cannot reach the page unescaped", () => {
  const html = optOutControl({ ...PERSON, id: '"><script>alert(1)</script>' }, true);
  assert.ok(!html.includes('<script>'), html.slice(0, 200));
});

// --- what opting out writes ---------------------------------------------------

test('opting out no longer demands a note, and no longer writes one', () => {
  const route = ROUTE('opt-out');

  assert.ok(!/Say how they told you/.test(route), 'it still refuses without a note');
  assert.ok(!/unsubscribed_note:/.test(route), 'it still writes a note');
});

test('what an audit actually asks for is still written', () => {
  const route = ROUTE('opt-out');

  for (const column of ['unsubscribed_at', "unsubscribed_via: 'BY_HAND'", 'unsubscribed_by']) {
    assert.ok(route.includes(column), `${column} is no longer recorded`);
  }
});

// --- what opting back in writes, and what it must never write ------------------

test('opting back in never manufactures a consent record', () => {
  // sms_consent_at / _source / _ip are the evidence that THEY agreed - what a
  // carrier asks for at 10DLC registration and what a TCPA complaint turns on.
  // Pressing a button in ops is not the customer agreeing to anything.
  const route = ROUTE('opt-in');

  for (const column of ['sms_consent_at', 'sms_consent_source', 'sms_consent_ip']) {
    assert.ok(!route.includes(column), `opt-in writes ${column}, which is somebody else's word`);
  }
});

test('it records who did it and when', () => {
  const route = ROUTE('opt-in');

  assert.ok(route.includes('resubscribed_at'), 'nothing says when');
  assert.ok(route.includes('resubscribed_by'), 'nothing says who');
  assert.ok(route.includes("status: 'ACTIVE'"), route.slice(0, 400));
});

test('it clears the opt-out rather than leaving it set beside the new status', () => {
  const route = ROUTE('opt-in');

  for (const column of ['unsubscribed_at: null', 'unsubscribed_via: null', 'unsubscribed_by: null']) {
    assert.ok(route.includes(column), `${column} is left behind`);
  }
});

test('neither button texts anybody', () => {
  // The opt-out does not text to say we have stopped - "they asked us to stop,
  // and one more message saying we have stopped is the joke that writes
  // itself" - and this must not text to say we have started.
  for (const name of ['opt-out', 'opt-in']) {
    const route = ROUTE(name);
    for (const sends of ['sendAndLog', 'notify.', 'sms.sendMessage']) {
      assert.ok(!route.includes(sends), `${name} sends something via ${sends}`);
    }
  }
});

test('both are behind messages.send, the line the opt-out already drew', () => {
  for (const name of ['opt-out', 'opt-in']) {
    assert.ok(ROUTE(name).includes("may('messages.send')"), `${name} is not behind messages.send`);
  }
});

test('STOP is untouched by any of it', () => {
  // It is answered in compliance.js before the AI ever sees a message, on every
  // number, and notify.sendAndLog() refuses an opted-out number at the last
  // gate. Whatever anybody presses in ops, the customer can always take
  // themselves back off.
  assert.equal(compliance.statusFor('OPT_OUT'), 'UNSUBSCRIBED');
  assert.equal(compliance.statusFor('OPT_IN'), 'ACTIVE');

  const notify = withoutComments(SRC('core', 'notify.js'));
  assert.ok(notify.includes('await hasOptedOut(to)'), 'the last gate is gone');
});

// --- Edit ---------------------------------------------------------------------

test('only two cards can be opened, and the query string is not trusted', () => {
  // ?edit=<anything> is a visitor's to type and it decides which markup renders.
  const src = withoutComments(SRC('routes', 'admin.js'));

  assert.ok(
    /\['details', 'wash'\]\.includes\(String\(\(req\.query \|\| \{\}\)\.edit \|\| ''\)\)/.test(src),
    'the edit flag is read off whatever was in the URL'
  );
});

test('Edit is a link and Save is a POST, so a refresh cannot re-save', () => {
  const src = SRC('routes', 'admin.js');

  assert.ok(/\?edit=details#details/.test(src), 'there is no Edit link on Details');
  assert.ok(/\?edit=wash#wash/.test(src), 'there is no Edit link on Wash');

  for (const name of ['details', 'wash']) {
    assert.ok(
      new RegExp(`method="post" action="/ops/customers/\\$\\{(escapeHtml\\(person\\.id\\)|id)\\}/${name}"`).test(src),
      `${name} does not save with a POST`
    );
    assert.ok(ROUTE(name).includes('res.redirect(303'), `${name} does not answer with a redirect`);
  }
});

test('Cancel is a plain link back, holding nothing', () => {
  const form = washForm(PERSON, { water_temp: 'WARM' });

  assert.match(form, /<a class="btn btn-outline" href="\/ops\/customers\/[^"]+">Cancel<\/a>/);
  // Nothing is stashed anywhere between Edit and Save, so Cancel cannot leave
  // half of an edit behind.
  assert.ok(!/localStorage|sessionStorage/.test(SRC('routes', 'admin.js')));
});

test('the page still needs no JavaScript', () => {
  const src = SRC('routes', 'admin.js');
  const form = washForm(PERSON, {});

  for (const forbidden of ['onclick', 'onsubmit', 'onchange', 'addEventListener']) {
    assert.ok(!form.includes(forbidden), `the wash form uses ${forbidden}`);
    assert.ok(!optOutControl(PERSON, true).includes(forbidden), `the opt-out uses ${forbidden}`);
  }
  assert.ok(src.indexOf('function washForm(') > 0);
});

// --- the address --------------------------------------------------------------

test('the address is editable and the phone is not', () => {
  const src = SRC('routes', 'admin.js');
  const route = ROUTE('details');

  for (const column of ['address_line1', 'address_line2', 'city', 'state', 'postal_code']) {
    assert.ok(route.includes(column), `${column} cannot be saved`);
  }

  // The phone is the identity on this system: the thread is keyed on it, the
  // carrier sends to it, and every inbound is matched against it. Changing it
  // here would orphan a conversation rather than move it.
  assert.ok(!/phone:/.test(route), 'the phone number is editable');
  assert.ok(!/name:/.test(route), 'the name is editable here as well as by text');
  assert.ok(src.indexOf('id="details"') > 0, 'the Edit link has nothing to land on');
});

test('A MOVE THROWS THE MAP PIN AWAY', () => {
  // Without this the address changes and the coordinates do not, so every
  // routing decision after it is made about the old house - which is exactly
  // what happened when a customer moved to Glen Rock and the map kept them in
  // Fair Lawn. Correcting a typo in a town moves them as surely as a house move.
  const route = ROUTE('details');

  assert.ok(route.includes('geocode.clearPinIfMoved(person, changes)'), route.slice(0, 900));
  assert.ok(route.includes('geocode.locate('), 'the new address is never looked up');
});

// --- the wash -----------------------------------------------------------------

test('every list on the form is read from wash.js and booking.js, never typed', () => {
  const src = withoutComments(SRC('routes', 'admin.js'));
  const form = src.slice(src.indexOf('function washForm('), src.indexOf('function optOutControl('));

  assert.ok(form.includes('wash.OPTIONS.water_temp.choices'), form.slice(0, 0));
  assert.ok(form.includes('wash.OPTIONS.fabric_softener.choices'), form.slice(0, 0));
  assert.ok(form.includes('wash.DETERGENTS'), form.slice(0, 0));
  assert.ok(form.includes('booking.PICKUP_METHODS'), form.slice(0, 0));

  // An option typed here and nowhere else is one the laundromat never hears
  // about.
  assert.ok(!/'COLD'|'WARM'|'HOT'|'STANDARD'|'NONE'/.test(form), 'a value is typed into the form');
});

test('the form offers every choice the system has, and no others', () => {
  const form = washForm(PERSON, {});

  for (const c of wash.OPTIONS.water_temp.choices) {
    assert.ok(form.includes(`value="${c.value}"`), `${c.value} is missing`);
  }
  for (const d of wash.DETERGENTS) {
    assert.ok(form.includes(`value="${d.value}"`), `${d.value} is missing`);
  }
});

test('"not set" is an option, and it is what a new customer shows', () => {
  // A customer who has chosen nothing is a real state - it is the state every
  // new customer is in - and it is the whole of EXPLICIT against DEFAULT on the
  // intake table.
  const form = washForm(PERSON, {});

  assert.match(form, /<option value=""( selected)?>Not set/);
  assert.equal((form.match(/<option value="" selected>/g) || []).length, 4, 'a default is pre-picked');
});

test('a saved choice comes back selected', () => {
  const form = washForm(PERSON, {
    water_temp: 'WARM',
    fabric_softener: 'NONE',
    detergent: 'FREE_AND_CLEAR',
    special_instructions: 'front porch',
  });

  assert.match(form, /<option value="WARM" selected>/);
  assert.match(form, /<option value="NONE" selected>/);
  assert.match(form, /<option value="FREE_AND_CLEAR" selected>/);
  assert.ok(form.includes('>front porch</textarea>'));
});

test('a value we no longer offer reads as not set, not as a choice', () => {
  // A softener stored as the boolean it used to be, or a withdrawn option, must
  // not come back selected - that is somebody's clothes washed a way nobody
  // chose with the screen saying otherwise.
  const form = washForm(PERSON, { water_temp: 'TEPID', fabric_softener: true });

  assert.ok(!form.includes('value="TEPID"'), 'it offered a temperature we do not do');
  assert.equal((form.match(/<option value="" selected>/g) || []).length, 4);
});

test('saving refuses anything outside the lists, and blank clears rather than defaults', () => {
  const route = ROUTE('wash');

  assert.ok(route.includes('wash.isValid(key, value)'), 'the wash values are not checked');
  assert.ok(route.includes('wash.isValidDetergent(detergent)'), 'the detergent is not checked');
  assert.ok(route.includes('booking.PICKUP_METHODS.includes(method)'), 'the pickup method is not checked');

  // Blank deletes the key. Writing COLD in for somebody who never said cold
  // would make the intake table start calling a default a choice.
  assert.ok(route.includes('delete prefs[key]'), 'a blank answer writes a default in');
  assert.ok(route.includes('delete prefs.detergent'), route.slice(0, 0));
});

test('preferences are merged, never replaced', () => {
  // One JSON column holds more than this form shows - the pickup spot the AI
  // saved, a dropoff spot, a note somebody put there by hand - and writing the
  // form's five keys as the whole object would silently delete every one.
  const route = ROUTE('wash');

  assert.ok(/\{ \.\.\.\(person\.preferences \|\| \{\}\) \}/.test(route), route.slice(0, 600));
});

test('both saves are behind customers.view, not messages.send', () => {
  // Correcting a street number is not causing a text. A driver reaches neither.
  for (const name of ['details', 'wash']) {
    assert.ok(ROUTE(name).includes("may('customers.view')"), `${name} is behind the wrong permission`);
  }
});

// --- detergent is settable and is still not a question ------------------------

test('detergent is not on the customer-facing list, so nothing asks for it', () => {
  // Neil's own call and it stands: "detergent is just gonna be standard across
  // the board... we're not gonna ask about that." What changed is that an admin
  // can tell ONE laundromat to use something different for ONE customer.
  assert.ok(!wash.KEYS.includes('detergent'), 'detergent is back in the wash question');
  assert.ok(!wash.QUESTION.toLowerCase().includes('detergent'), wash.QUESTION);

  const brain = SRC('core', 'brain.js');
  const actions = SRC('core', 'actions.js');
  const enumBlock = brain.slice(brain.indexOf("'water_temp',"), brain.indexOf('Which single thing to change'));

  assert.ok(!enumBlock.includes('detergent'), 'the AI can set a detergent');
  assert.ok(
    !/^\s*'detergent',$/m.test(actions.slice(actions.indexOf('separate_darks') - 900)),
    'the AI can set a detergent'
  );
});

test('it costs nothing, and surchargeFor cannot see it', () => {
  // The old detergent choice was +$2 and was never actually billed, which the
  // reconciliation report found.
  assert.equal(wash.surchargeFor({ detergent: 'FREE_AND_CLEAR' }), 0);
});

test('the laundromat is told the detergent either way', () => {
  const printed = (prefs) => wash.washLines(prefs).find(([label]) => label === 'Detergent');

  assert.deepEqual(printed({}), ['Detergent', 'Standard']);
  assert.deepEqual(printed({ detergent: 'FREE_AND_CLEAR' }), ['Detergent', 'Free and clear']);

  // Something stored by hand that we do not offer falls back rather than
  // printing itself at somebody standing over a machine.
  assert.deepEqual(printed({ detergent: 'WHATEVER_WAS_IN_THE_CUPBOARD' }), ['Detergent', 'Standard']);
});

// --- the display bug this sat on top of ---------------------------------------

test('NO SOFTENER NO LONGER READS AS YES', () => {
  // The card read `prefs.fabric_softener ? 'yes' : 'no'`, and the stored values
  // are STANDARD and NONE - both truthy - so a customer who asked for NO
  // softener had this page telling everybody they wanted some.
  // STRIPPED FIRST. The line above describes the bug, so a test reading the
  // raw file finds its own warning and fails. That has happened here before.
  const src = withoutComments(SRC('routes', 'admin.js'));

  assert.ok(
    !/prefs\.fabric_softener \? 'yes' : 'no'/.test(src),
    'the softener is still read off the raw column as a boolean'
  );

  // It reads through washLines() now, which is what the laundromat's own ticket
  // reads, so the two cannot say different things about one bag.
  assert.deepEqual(
    wash.washLines({ fabric_softener: 'NONE' }).find(([label]) => label === 'Fabric softener'),
    ['Fabric softener', 'No softener']
  );
});
