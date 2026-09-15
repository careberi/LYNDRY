'use strict';

// ---------------------------------------------------------------------------
// A PLAIN LINK TO ONE GENERIC PAGE, AND NOTHING MORE THAN THAT.
//
// Neil's decision lock, 15 September. Most of what is pinned here is the
// must-not list, because every item on it is a way a hyperlink turns into a
// feature:
//
//   not a button        no form, no submit, no confirmation
//   no state change     opening it, refreshing it and going Back do nothing
//   no second scan      it takes no code, no token and no sign-in
//   nothing private     it takes no code and no order, so there is nothing
//                       to leak - only a language, which decides wording
//   not duplicated      one page, linked from the shared shell
//
// Nothing here touches the database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const bags = require('../src/core/bags');
const { site } = require('../src/web/site');
const { processingGuideBody, TURNAROUND_ES } = require('../src/web/processing-guide');

const SRC = (...bits) =>
  fs
    .readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8')
    .split('\r\n')
    .join('\n');

const guide = processingGuideBody();
const bagRoute = SRC('routes', 'bag.js');

// The shared shell every bag screen renders through.
function shell() {
  const at = bagRoute.indexOf('function page({');
  assert.notEqual(at, -1, 'the bag page shell has moved');
  return bagRoute.slice(at, bagRoute.indexOf('\n}\n', at));
}

// --- it is a link ------------------------------------------------------------

test('THE LINK IS A PLAIN HYPERLINK, NOT A BUTTON', () => {
  const body = shell();
  assert.match(body, /<a href="\$\{GUIDE_PATH\}\?lang=\$\{lang\}">/);
  assert.ok(!/<button|type="submit"|class="btn/.test(body), 'the link became a control');
});

test('AND IT OPENS THE GUIDE IN THE LANGUAGE ALREADY ON SCREEN', () => {
  // Neil, 15 September. The link was a bare /processing, so a laundromat
  // reading the bag page in Spanish tapped through to an English guide - which
  // is the one moment the translation is actually needed.
  //
  // The shell already knows the language; it just was not passing it on.
  assert.match(shell(), /GUIDE_PATH\}\?lang=\$\{lang\}/);
});

test('and it is labelled Processing Instructions', () => {
  assert.match(shell(), /Processing Instructions/);
});

test('IT IS IN THE SHARED SHELL, so every bag screen has it', () => {
  // A live tag, one waiting to be released, a finished one, an expired one and
  // "this label isn't in use" all render through page(). Putting the link there
  // is what makes Neil's edge cases true without a branch for any of them.
  const calls = bagRoute.split('return page({').length - 1;
  assert.ok(calls >= 6, `only ${calls} screens render through the shell`);

  // And it is written once, not once per screen.
  assert.equal(bagRoute.split('Processing Instructions').length - 1, 2, 'the label is duplicated');
});

test('and the guide does not link to itself', () => {
  assert.match(shell(), /guideLink/);
  assert.match(bagRoute, /guideLink: false/);
});

// --- it changes nothing ------------------------------------------------------

test('THE ROUTE IS A GET THAT WRITES NOTHING', () => {
  const at = bagRoute.indexOf("router.get('/processing'");
  assert.notEqual(at, -1, 'the guide route has moved');
  const body = bagRoute.slice(at, bagRoute.indexOf('\n});\n', at));

  assert.ok(!/router\.post/.test(body));
  assert.ok(!/db\.|update\(|insert\(|transition\(/.test(body), 'the guide route touches data');
  assert.ok(!/await/.test(body), 'the guide route does work that could fail');
});

test('AND THE PAGE HAS NOTHING TO SUBMIT', () => {
  // No form, no button, no input, no script. Refreshing it or coming back to it
  // with Back cannot do anything, because there is nothing on it that does.
  assert.ok(!/<form/.test(guide), 'the guide grew a form');
  assert.ok(!/<button/.test(guide), 'the guide grew a button');
  assert.ok(!/<input|<select|<textarea/.test(guide), 'the guide grew a field');
  assert.ok(!/<script/.test(guide), 'the guide grew a script');
});

// --- it needs nothing to open ------------------------------------------------

test('IT TAKES NOTHING BUT A LANGUAGE', () => {
  // No code, no token, no order - which is what makes "nothing private" true by
  // construction rather than by care: there is nothing for it to look up. The
  // language is the one argument, and it decides wording and nothing else.
  assert.equal(processingGuideBody.length, 0, 'the guide takes a required argument');
  assert.notEqual(processingGuideBody('en'), processingGuideBody('es'));

  const at = bagRoute.indexOf("router.get('/processing'");
  const body = bagRoute.slice(at, bagRoute.indexOf('\n});\n', at));
  assert.ok(!/req\.params|req\.query\.code|token/.test(body), 'the guide route reads a code');
});

test('and no sign-in guards it', () => {
  const at = bagRoute.indexOf("router.get('/processing'");
  const body = bagRoute.slice(at, bagRoute.indexOf('\n});\n', at));
  assert.ok(!/guard|requireAdmin|requireCustomer|may\(/.test(body), 'the guide asks for a sign-in');
});

// --- nothing private on it ---------------------------------------------------

test('NOTHING PRIVATE IS ON THE PAGE', () => {
  // A customer can open their own bag tag and sees the same link, so this is
  // written as though a stranger is reading it.
  const clean = guide.replace(/<!--[\s\S]*?-->/g, '');

  assert.ok(!/\$\d/.test(clean), 'a price reached the guide');
  assert.ok(!/wholesale|we pay|per pound/i.test(clean), 'a commercial term reached the guide');
  assert.ok(!/address|postal|street/i.test(clean), 'an address reached the guide');

  // The one mention of a customer is the guide saying it holds no customer.
  const mentions = clean.match(/[^.]*customer[^.]*\./gi) || [];
  assert.equal(mentions.length, 1);
  assert.match(mentions[0], /identifies the .*order.*, not the customer/);
});

// --- the figures come from the running system --------------------------------

test('THE STICKER COUNT IS THE CONSTANT, never a typed number', () => {
  // CLAUDE.md is explicit: it went from four to three, and it is a constant so
  // a change reaches the sheet, the roll, the QR page and this guide together.
  assert.equal(bags.STICKERS_PER_TAG, 3);
  assert.match(guide, /Three detachable stickers/);

  const src = SRC('web', 'processing-guide.js').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /bags\.STICKERS_PER_TAG/);
  assert.ok(!/three detachable/i.test(src), 'the sticker count is typed into the copy');
});

test('and the turnaround and the phone number are read, not typed', () => {
  assert.match(guide, new RegExp(site.turnaround));

  const src = SRC('web', 'processing-guide.js').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /site\.turnaround/);
  assert.match(src, /site\.callPhoneDisplay/);
  assert.ok(!/\d{3}-\d{3}-\d{4}/.test(src), 'a phone number is typed into the guide');
});

test('THE OWNER CELL IS NEVER ON THIS PAGE', () => {
  // Neil, 15 September: only the business number. His guide had the owner cell
  // as an escalation for a laundromat that could not get through - but this
  // page has no login on it and a customer can open their own bag tag and reach
  // it, so a personal mobile here is published to anybody holding a sticker.
  //
  // The guide does not read the setting AT ALL, so there is no value anybody
  // could set that would put it back.
  const src = SRC('web', 'processing-guide.js').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/supportPhone/.test(src), 'the guide reads the owner cell setting');
  assert.ok(!/ownerCell/.test(src), 'the owner cell survived');

  for (const lang of ['en', 'es']) {
    const body = processingGuideBody(lang);
    const numbers = [...new Set(body.match(/\d{3}-\d{3}-\d{4}/g) || [])];
    assert.deepEqual(numbers, [site.callPhoneDisplay], `${lang} shows more than the business line`);
  }
});

// --- both languages ----------------------------------------------------------

test('THE GUIDE IS FULLY TRANSLATED, and a gap cannot hide', () => {
  // Neil, 15 September: the bag page already switches language, so the guide
  // has to match. Every string is an { en, es } pair rather than a lookup that
  // falls back - a miss renders as undefined rather than as quiet English,
  // which on an instruction about not mixing two customers' laundry is the
  // difference between a blemish and a page that looks translated and is not.
  const es = processingGuideBody('es');

  assert.ok(!/undefined/.test(es), 'a Spanish string is missing');
  assert.match(es, /Guia de procesamiento/);
  assert.match(es, /Para la lavanderia/);
});

test('with the same eleven steps and the same four rules', () => {
  const es = processingGuideBody('es');

  const steps = [...es.matchAll(/>Paso (\d+)</g)].map((m) => Number(m[1]));
  assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  for (const rule of [
    /Nunca mezcle pedidos de LYNDRY/,
    /sin calcomania/,
    /bolsa desechable en que llego/,
    /deben ser igual a las bolsas terminadas/,
  ]) {
    assert.match(es, rule);
  }
});

test('and the Spanish carries no accents, like the rest of the bag pages', () => {
  // bag.js's sixty ES entries are plain ASCII and this link sits directly under
  // them. Two conventions on one screen reads as a mistake.
  const es = processingGuideBody('es');
  const accented = es.match(/[À-ɏ]/g) || [];
  assert.deepEqual([...new Set(accented)], [], 'an accent crept into the Spanish');
});

test('THE TURNAROUND IS SAID IN SPANISH TOO', () => {
  // It is read from site.turnaround, so it needed a Spanish form or the page
  // would read "LYNDRY garantiza entrega next day".
  assert.equal(TURNAROUND_ES[site.turnaround], 'al dia siguiente');
  assert.match(processingGuideBody('es'), /entrega al dia siguiente/);

  // An unmapped turnaround falls through to the English rather than to
  // undefined: visible on the page, which is the point.
  assert.equal(TURNAROUND_ES.somethingElse, undefined);
});

test('and the page follows the language the bag page was in', () => {
  const route = SRC('routes', 'bag.js');
  assert.match(route, /processingGuideBody\(lang\)/, 'the guide ignores the language');
});

// --- the guide itself --------------------------------------------------------

test('all eleven steps are there, in order', () => {
  const steps = [...guide.matchAll(/>Step (\d+)</g)].map((m) => Number(m[1]));
  assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('and the four rules survive', () => {
  for (const rule of [
    /Never mix LYNDRY orders/,
    /without a sticker/,
    /disposable bag it arrived in/,
    /Stickers selected must equal finished bags/,
  ]) {
    assert.match(guide, rule);
  }
});

// --- the guide has its own language buttons ---------------------------------

test('THE GUIDE CARRIES THE SAME TWO BUTTONS /o/ HAS', () => {
  // Neil, 15 September, from the live site: /processing had no English /
  // Espanol buttons at all. The Spanish guide existed and rendered at
  // ?lang=es, and nothing on the page could reach it - so the guide was
  // bilingual and the page was not, and an attendant who needed the Spanish
  // had to be told a URL.
  const at = bagRoute.indexOf("router.get('/processing'");
  assert.notEqual(at, -1, 'the guide route has moved');
  const body = bagRoute.slice(at, bagRoute.indexOf('\n});\n', at));

  assert.match(body, /langToggleHere\(req, lang\)/, 'the guide has no language buttons');

  // The SAME function the bag pages use, not a second pair of links that could
  // drift. It builds both hrefs off req.originalUrl, so ?lang= stays in the URL
  // and anything else on the query string survives.
  assert.match(bagRoute, /function langToggleHere/);
});

test('and the browser tab is translated with the page', () => {
  // The Spanish page rendered a Spanish heading under an English tab.
  const at = bagRoute.indexOf("router.get('/processing'");
  const body = bagRoute.slice(at, bagRoute.indexOf('\n});\n', at));

  assert.match(body, /title: say\('Processing guide'\)/);
  assert.match(bagRoute, /'Processing guide': 'Guia de procesamiento'/);
});
