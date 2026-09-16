'use strict';

// ---------------------------------------------------------------------------
// AFTER A HANDOFF, THE AI SAYS NOTHING.
//
// Neil's rule, 16 September, off one real conversation. Manpreet Singh, 201
// 954 5473, 09:54 to 12:17 on 16 September:
//
//   09:59:10  handoff_to_human fires. An issue is raised.
//   09:59:11  "I've passed it to a manager... they'll come back to you shortly."
//   09:59:40  ...and then twenty more AI messages, including an apology for not
//             understanding, the wash question, "when would you like it picked
//             up?" three times, a "Welcome back" nobody asked for, and a
//             follow-up nudge two hours later.
//   10:03:04  A person rang him. No answer. The machine had been talking over
//             that call for four minutes.
//
// TWO FAULTS, STACKED, AND BOTH ARE PINNED BELOW.
//
//   1. handoffToHuman() raised the issue WITHOUT aiHold, which defaults to
//      false - so holdFor() found nothing and the gate never engaged at all.
//      The issue row for Manpreet has ai_hold = false on it.
//
//   2. The gate, when it did engage, released itself. It asked
//      personHasReplied(), which counted ANY outbound since the hold - and the
//      first outbound after a handoff is always the AI's own "a manager will
//      come back to you shortly". So the handoff line lifted the hold it had
//      just created, on the customer's very next message.
//
// The replay at the bottom drives the REAL gate over the REAL sequence of that
// thread and asserts zero further AI texts until a person writes.
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

// --- a stub database that answers the two queries the gate makes ------------
//
// Deliberately NOT a re-implementation of the gate. It stands in for Postgres
// and nothing else; every decision below is made by the real issues.js.
function stubDb({ issues = [], messages = [] }) {
  const build = (rows) => {
    const state = { rows: [...rows], limit: null };
    const api = {
      select() {
        return api;
      },
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
      order() {
        return api;
      },
      limit(n) {
        state.limit = n;
        return api;
      },
      then(resolve) {
        const rows = state.limit == null ? state.rows : state.rows.slice(0, state.limit);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return api;
  };

  return {
    from(table) {
      if (table === 'issues') return build(issues);
      if (table === 'messages') return build(messages);
      return build([]);
    },
  };
}

// Load a fresh copy of issues.js against a stub database.
function issuesWith(db) {
  const dbPath = require.resolve(path.join(__dirname, '..', 'src', 'db.js'));
  const issuesPath = require.resolve(path.join(__dirname, '..', 'src', 'core', 'issues.js'));

  const savedDb = require.cache[dbPath];
  const savedIssues = require.cache[issuesPath];

  require.cache[dbPath] = new Module(dbPath, null);
  require.cache[dbPath].filename = dbPath;
  require.cache[dbPath].loaded = true;
  require.cache[dbPath].exports = db;
  delete require.cache[issuesPath];

  const mod = require(issuesPath);

  return {
    mod,
    restore() {
      delete require.cache[issuesPath];
      if (savedDb) require.cache[dbPath] = savedDb;
      else delete require.cache[dbPath];
      if (savedIssues) require.cache[issuesPath] = savedIssues;
    },
  };
}

const CUSTOMER = '97fe8b70-8809-4bbb-9682-e4b494ad8f30';
const HANDOFF_AT = '2026-09-16T13:59:10.179Z';

const held = [{ id: 'i1', customer_id: CUSTOMER, status: 'OPEN', ai_hold: true, created_at: HANDOFF_AT, reason: 'stuck' }];

// Manpreet's thread from the handoff onwards, outbound only, in order. Every
// one of these is a message the AI actually sent after promising a manager.
const AFTER_HANDOFF = [
  ["2026-09-16T13:59:11.964Z", 'AI', "I'm sorry about this. I've passed it to a manager..."],
  ["2026-09-16T13:59:40.248Z", 'AI', 'Thanks for bearing with us, Manpreet...'],
  ["2026-09-16T14:00:09.625Z", 'AI', "Sorry, I'm not quite sure what you mean by that..."],
  ["2026-09-16T14:00:41.763Z", 'AI', "We're out from 8 in the morning right through to 6..."],
  ["2026-09-16T14:01:46.491Z", 'AI', 'Understood, nothing today... How would you like your laundry washed?'],
  ["2026-09-16T14:09:16.254Z", null, "Welcome back. Say when you'd like a pickup and I'll book it."],
  ["2026-09-16T16:14:52.876Z", 'FOLLOW_UP', 'Just checking back in, no rush at all...'],
];

const asMessage = ([at, kind, body]) => ({
  id: at,
  customer_id: CUSTOMER,
  direction: 'OUTBOUND',
  sent_by: null, // none of them was typed by a person - that is the whole point
  kind,
  body,
  created_at: at,
});

// --- the replay -------------------------------------------------------------

test('REPLAY: after the handoff, the AI is silent at every single step', async () => {
  const log = [];

  // Walk the thread forward one outbound at a time, asking the real gate at
  // each point whether the AI may speak. Every answer must be "no".
  for (let i = 0; i <= AFTER_HANDOFF.length; i += 1) {
    const soFar = AFTER_HANDOFF.slice(0, i).map(asMessage);
    const { mod, restore } = issuesWith(stubDb({ issues: held, messages: soFar }));

    try {
      const { quiet } = await mod.aiMustStayQuiet(CUSTOMER);
      log.push({ after: i, quiet });
    } finally {
      restore();
    }
  }

  const spoke = log.filter((entry) => !entry.quiet);

  assert.deepEqual(
    spoke,
    [],
    `the AI was allowed to speak after the handoff at these points: ${JSON.stringify(spoke)}`
  );
  assert.equal(log.length, AFTER_HANDOFF.length + 1);
});

test("REPLAY: the AI's own handoff line does not release the hold", async () => {
  // Exactly the bug. One outbound since the hold, and it is the AI's own.
  const justTheHandoffLine = [asMessage(AFTER_HANDOFF[0])];
  const { mod, restore } = issuesWith(stubDb({ issues: held, messages: justTheHandoffLine }));

  try {
    const { quiet } = await mod.aiMustStayQuiet(CUSTOMER);
    assert.equal(quiet, true, "the AI's own message lifted its own hold");
  } finally {
    restore();
  }
});

test('REPLAY: a follow-up nudge two hours later is still refused', async () => {
  const everything = AFTER_HANDOFF.map(asMessage);
  const { mod, restore } = issuesWith(stubDb({ issues: held, messages: everything }));

  try {
    const { quiet } = await mod.aiMustStayQuiet(CUSTOMER);
    assert.equal(quiet, true, 'a chase went out on a thread a person owns');
  } finally {
    restore();
  }
});

test('a message a PERSON typed lifts it, and only that', async () => {
  const withAPerson = [
    ...AFTER_HANDOFF.map(asMessage),
    {
      id: 'human',
      customer_id: CUSTOMER,
      direction: 'OUTBOUND',
      sent_by: 'aaf2eae9-f0c7-4e11-bf77-80901526c4f9',
      kind: 'PERSON',
      body: 'Hi Manpreet, this is Neil - sorry about the confusion.',
      created_at: '2026-09-16T17:00:00.000Z',
    },
  ];

  const { mod, restore } = issuesWith(stubDb({ issues: held, messages: withAPerson }));

  try {
    const { quiet, hold } = await mod.aiMustStayQuiet(CUSTOMER);
    assert.equal(quiet, false, 'a person wrote and the AI is still muted');
    assert.ok(hold, 'the caller needs the hold in order to resolve it');
  } finally {
    restore();
  }
});

test('a person who wrote BEFORE the handoff does not count', async () => {
  const earlier = [
    {
      id: 'old',
      customer_id: CUSTOMER,
      direction: 'OUTBOUND',
      sent_by: 'aaf2eae9-f0c7-4e11-bf77-80901526c4f9',
      kind: 'PERSON',
      body: 'Morning!',
      created_at: '2026-09-16T13:00:00.000Z',
    },
    ...AFTER_HANDOFF.map(asMessage),
  ];

  const { mod, restore } = issuesWith(stubDb({ issues: held, messages: earlier }));

  try {
    const { quiet } = await mod.aiMustStayQuiet(CUSTOMER);
    assert.equal(quiet, true, 'a message from before the handoff lifted it');
  } finally {
    restore();
  }
});

test('with no hold at all the AI speaks normally', async () => {
  const { mod, restore } = issuesWith(stubDb({ issues: [], messages: [] }));

  try {
    const { quiet, hold } = await mod.aiMustStayQuiet(CUSTOMER);
    assert.equal(quiet, false);
    assert.equal(hold, null);
  } finally {
    restore();
  }
});

test('an issue that is not a hold does not silence the AI', async () => {
  const notAHold = [{ ...held[0], ai_hold: false }];
  const { mod, restore } = issuesWith(stubDb({ issues: notAHold, messages: [] }));

  try {
    const { quiet } = await mod.aiMustStayQuiet(CUSTOMER);
    assert.equal(quiet, false, 'a plain issue is a question for a person, not a mute');
  } finally {
    restore();
  }
});

test('a resolved hold does not silence the AI for ever', async () => {
  const closed = [{ ...held[0], status: 'RESOLVED' }];
  const { mod, restore } = issuesWith(stubDb({ issues: closed, messages: [] }));

  try {
    const { quiet } = await mod.aiMustStayQuiet(CUSTOMER);
    assert.equal(quiet, false);
  } finally {
    restore();
  }
});

test('it fails QUIET when the lookup itself breaks', async () => {
  const broken = {
    from() {
      throw new Error('database is down');
    },
  };
  const { mod, restore } = issuesWith(broken);

  try {
    const { quiet, unknown } = await mod.aiMustStayQuiet(CUSTOMER);
    assert.equal(quiet, true, 'talking over a person is worse than a late reply');
    assert.equal(unknown, true);
  } finally {
    restore();
  }
});

// --- the two faults, at the source -----------------------------------------

test('a handoff arms the hold', () => {
  const src = withoutComments(SRC('core', 'actions.js'));
  const at = src.indexOf('async function handoffToHuman');
  assert.ok(at > 0, 'handoffToHuman is missing');
  const fn = src.slice(at, src.indexOf('\nasync function ', at + 10));

  assert.ok(fn.includes('issues.raise('), fn);
  assert.ok(fn.includes('aiHold: true'), 'the handoff raises an issue that does not mute the AI');
});

test('personHasReplied is gone and cannot come back', () => {
  const src = SRC('core', 'issues.js');

  assert.ok(!/async function personHasReplied/.test(src), 'the self-releasing check is back');
  assert.ok(!/^\s*personHasReplied,$/m.test(src), 'it is exported again');

  // And nothing CALLS it. Comments are stripped first: sms.js explains the bug
  // at the point it was fixed, and a sweep that reads its own warning is a test
  // passing for the wrong reason.
  for (const bits of [['routes', 'sms.js'], ['core', 'actions.js'], ['core', 'followups.js']]) {
    assert.ok(
      !withoutComments(SRC(...bits)).includes('personHasReplied'),
      `${bits.join('/')} still calls it`
    );
  }
});

test('the release test requires a person, by sent_by', () => {
  const src = withoutComments(SRC('core', 'issues.js'));
  const at = src.indexOf('async function personHasWritten');
  const fn = src.slice(at, src.indexOf('\nasync function ', at + 10));

  assert.ok(fn.includes("not('sent_by', 'is', null)"), fn);
  assert.ok(fn.includes("eq('direction', 'OUTBOUND')"), fn);
});

test('the webhook asks the one owner, and checks quiet before the hold', () => {
  const src = withoutComments(SRC('routes', 'sms.js'));
  const at = src.indexOf('issues.aiMustStayQuiet');
  assert.ok(at > 0, 'the webhook no longer uses the shared gate');

  const after = src.slice(at, at + 600);
  const quietAt = after.indexOf('if (quiet)');
  const holdAt = after.indexOf('if (hold)');

  assert.ok(quietAt > 0 && holdAt > 0, after);
  assert.ok(quietAt < holdAt, 'a failed lookup returns no hold, so quiet has to be tested first');
});
