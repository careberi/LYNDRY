'use strict';

// ---------------------------------------------------------------------------
// AFTER A HANDOFF, LYN SAYS NOTHING UNTIL A PERSON SWITCHES HER BACK ON.
//
// Neil's rule, 16 September, given as the answer to "when may she speak again":
//
//   "If the AI assistant is turned on, then she can reply right away when the
//    customer responds. But if the AI assistant is turned off, then she should
//    not reply at all."
//
// ONE STATE. This replaces a two-state arrangement that was live for one day
// and was wrong in a specific way: an issue raised with ai_hold silenced the
// AI, and then LIFTED ITSELF as soon as a person had written and the customer
// had come back. Under that rule a manager who sorted a problem out and
// deliberately left Lyn off had her switched straight back on by the customer's
// next message, over the top of the person who owned the thread.
//
// So: raising a holding issue PAUSES the thread, the pause is the only gate,
// and nothing in the codebase un-pauses it. A person does that with the toggle.
//
// The conversation this all came from is Manpreet Singh, 16 September: handoff
// at 09:59:10, "they'll come back to you shortly" at 09:59:11, and then twenty
// more AI messages over the top of a manager who was ringing him.
//
// Nothing here touches the database or the network: db is stubbed.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const SRC = (...bits) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', ...bits), 'utf8').split('\r\n').join('\n');

const withoutComments = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const PHONE = '+12019545473';

// --- a stub database, standing in for Postgres and nothing else ------------

function stubDb(rows) {
  const build = (table) => {
    const state = { rows: [...(rows[table] || [])], limit: null };
    const api = {
      select: () => api,
      eq(col, value) {
        state.rows = state.rows.filter((r) => r[col] === value);
        return api;
      },
      not(col, _is, value) {
        state.rows = state.rows.filter((r) => r[col] !== value);
        return api;
      },
      gt(col, value) {
        state.rows = state.rows.filter((r) => String(r[col]) > String(value));
        return api;
      },
      order: () => api,
      limit(n) {
        state.limit = n;
        return api;
      },
      maybeSingle: () => Promise.resolve({ data: state.rows[0] || null, error: null }),
      single: () => Promise.resolve({ data: state.rows[0] || null, error: null }),
      then(resolve) {
        const out = state.limit == null ? state.rows : state.rows.slice(0, state.limit);
        return Promise.resolve({ data: out, error: null }).then(resolve);
      },
    };
    return api;
  };
  return { from: (table) => build(table) };
}

function pauseModuleWith(db) {
  const dbPath = require.resolve(path.join(__dirname, '..', 'src', 'db.js'));
  const target = require.resolve(path.join(__dirname, '..', 'src', 'core', 'ai-pause.js'));
  const savedDb = require.cache[dbPath];
  const savedTarget = require.cache[target];

  require.cache[dbPath] = new Module(dbPath, null);
  require.cache[dbPath].filename = dbPath;
  require.cache[dbPath].loaded = true;
  require.cache[dbPath].exports = db;
  delete require.cache[target];

  const mod = require(target);
  return {
    mod,
    restore() {
      delete require.cache[target];
      if (savedDb) require.cache[dbPath] = savedDb;
      else delete require.cache[dbPath];
      if (savedTarget) require.cache[target] = savedTarget;
    },
  };
}

// --- the replay -------------------------------------------------------------

// Every outbound the AI actually sent after promising Manpreet a manager. Under
// the new rule NONE of them is reachable, because the thread is paused and no
// message of any kind can lift it.
const AFTER_HANDOFF = [
  'I am sorry about this. I have passed it to a manager...',
  'Thanks for bearing with us, Manpreet...',
  "Sorry, I'm not quite sure what you mean by that...",
  "We're out from 8 in the morning right through to 6...",
  'Understood, nothing today... How would you like your laundry washed?',
  "Welcome back. Say when you'd like a pickup and I'll book it.",
  'Just checking back in, no rush at all...',
];

test('REPLAY: once escalation pauses the thread, Lyn is silent at every step', async () => {
  const spoke = [];

  // Walk the thread forward. At each point the gate must still say paused, no
  // matter how many messages have gone since.
  for (let i = 0; i <= AFTER_HANDOFF.length; i += 1) {
    const messages = AFTER_HANDOFF.slice(0, i).map((body, n) => ({
      phone: PHONE,
      direction: 'OUTBOUND',
      body,
      sent_by: null,
      created_at: `2026-09-16T14:0${n}:00.000Z`,
    }));

    const { mod, restore } = pauseModuleWith(
      stubDb({ ai_pauses: [{ phone: PHONE, paused: true }], messages })
    );

    try {
      if (!(await mod.isPaused(PHONE))) spoke.push(i);
    } finally {
      restore();
    }
  }

  assert.deepEqual(spoke, [], `Lyn was allowed to speak after ${spoke} messages`);
});

test("a person's own message does not switch her back on", async () => {
  // The old rule lifted here. Under Neil's rule a manager writing changes
  // nothing: they are handling it, which is the whole point of the pause.
  const { mod, restore } = pauseModuleWith(
    stubDb({
      ai_pauses: [{ phone: PHONE, paused: true }],
      messages: [
        {
          phone: PHONE,
          direction: 'OUTBOUND',
          body: 'Hi, I am Neil. How can I help?',
          sent_by: 'aaf2eae9-f0c7-4e11-bf77-80901526c4f9',
          created_at: '2026-09-16T17:00:00.000Z',
        },
      ],
    })
  );

  try {
    assert.equal(await mod.isPaused(PHONE), true);
  } finally {
    restore();
  }
});

test('the toggle on means she answers the next message', async () => {
  const { mod, restore } = pauseModuleWith(
    stubDb({ ai_pauses: [{ phone: PHONE, paused: false }], messages: [] })
  );

  try {
    assert.equal(await mod.isPaused(PHONE), false);
  } finally {
    restore();
  }
});

test('a number with no row at all is not paused', async () => {
  const { mod, restore } = pauseModuleWith(stubDb({ ai_pauses: [], messages: [] }));

  try {
    assert.equal(await mod.isPaused(PHONE), false, 'a brand new number must not be silenced');
  } finally {
    restore();
  }
});

test('it still fails CLOSED when the lookup breaks', async () => {
  const broken = {
    from() {
      throw new Error('database is down');
    },
  };
  const { mod, restore } = pauseModuleWith(broken);

  try {
    assert.equal(await mod.isPaused(PHONE), true, 'talking over a person is worse than a late reply');
  } finally {
    restore();
  }
});

// --- escalation is what sets it --------------------------------------------

test('raising a holding issue pauses the thread', () => {
  const src = withoutComments(SRC('core', 'issues.js'));
  const fn = src.slice(src.indexOf('async function raise('), src.indexOf('async function ensurePaymentHold'));

  assert.ok(fn.includes("require('./ai-pause')"), 'an escalation no longer pauses Lyn');
  assert.ok(fn.includes('.pause('), fn);

  // The WHOLE guard, not just "aiHold &&" - that substring also appears in the
  // existing-issue branch below, so a looser check passes on the wrong line and
  // would miss the pause being switched off entirely.
  assert.ok(
    fn.includes('if (aiHold && customer && customer.phone) {'),
    'the pause is not guarded by a holding issue with a reachable phone'
  );
});

// BOTH WAYS IN. A brand new holding issue, and an existing issue that becomes
// one because the AI was coping and then stopped. The first version of this
// paused only after the insert, which missed the second - and the second is a
// thread that is already going wrong.
test('it pauses before the branching, so both kinds of escalation are covered', () => {
  const src = withoutComments(SRC('core', 'issues.js'));
  const fn = src.slice(src.indexOf('async function raise('), src.indexOf('async function ensurePaymentHold'));

  const pausesAt = fn.indexOf('.pause(');
  const branchesAt = fn.indexOf('if (existing)');
  const insertsAt = fn.indexOf('.insert(');

  assert.ok(pausesAt > 0 && branchesAt > 0 && insertsAt > 0, fn.slice(0, 200));
  assert.ok(pausesAt < branchesAt, 'an existing issue that becomes a hold would not pause');
  assert.ok(pausesAt < insertsAt, fn.slice(0, 200));
});

test('a handoff arms it', () => {
  const src = withoutComments(SRC('core', 'actions.js'));
  const at = src.indexOf('async function handoffToHuman');
  const fn = src.slice(at, src.indexOf('\nasync function ', at + 10));

  assert.ok(fn.includes('aiHold: true'), 'the handoff raises an issue that does not pause Lyn');
});

// --- nothing hands the thread back on its own ------------------------------

test('nothing in the codebase un-pauses a thread except an ops route', () => {
  const files = [
    ['routes', 'sms.js'],
    ['core', 'actions.js'],
    ['core', 'issues.js'],
    ['core', 'followups.js'],
    ['core', 'brain.js'],
    ['core', 'lyn.js'],
  ];

  for (const bits of files) {
    const src = withoutComments(SRC(...bits));
    assert.ok(
      !/aiPause\.resume\(|\.resume\(/.test(src),
      `${bits.join('/')} switches Lyn back on by itself - only a person may`
    );
  }
});

test('both self-lifting gates are gone and cannot come back', () => {
  const src = SRC('core', 'issues.js');

  assert.ok(!/async function personHasReplied/.test(src), 'the self-releasing check is back');
  assert.ok(!/async function aiMustStayQuiet/.test(src), 'the two-state gate is back');

  const code = withoutComments(src);
  assert.ok(!code.includes('aiMustStayQuiet,'), 'still exported');

  for (const bits of [['routes', 'sms.js'], ['core', 'actions.js']]) {
    const caller = withoutComments(SRC(...bits));
    assert.ok(!caller.includes('aiMustStayQuiet'), `${bits.join('/')} still calls it`);
    assert.ok(!caller.includes('personHasReplied'), `${bits.join('/')} still calls it`);
  }
});

test('the webhook gates on the pause and returns before composing anything', () => {
  const src = withoutComments(SRC('routes', 'sms.js'));
  const at = src.indexOf('aiPause.isPaused(from)');
  assert.ok(at > 0, 'the webhook no longer checks the pause');

  // The gate has to come before the AI is asked to decide anything.
  const decides = src.indexOf('brain.decide(');
  assert.ok(decides > at, 'the AI is consulted before the pause is checked');

  const after = src.slice(at, at + 900);
  assert.ok(/return;/.test(after), 'it does not return early');
});

test('the re-page sweep keeps the predicate it always needed', () => {
  const src = withoutComments(SRC('core', 'issues.js'));
  const at = src.indexOf('async function personHasWritten');
  assert.ok(at > 0, 'personHasWritten was removed - the re-page sweep needs it');

  const fn = src.slice(at, src.indexOf('\nasync function ', at + 10));
  assert.ok(fn.includes("not('sent_by', 'is', null)"), fn);
});
