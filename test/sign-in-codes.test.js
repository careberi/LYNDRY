'use strict';

// ---------------------------------------------------------------------------
// SIGN-IN CODES: TEXTED TEN SECONDS LATER, AND NOBODY IN WITHOUT A TAP.
//
// Neil, 11 September, for both sign-ins. The wait regresses quietly - a code
// that arrives instantly still works, so nobody notices it stopped waiting -
// and so does the tap: a form that submits itself still signs you in.
//
// Nothing here touches the database or sends a text.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');

const { createCodeSender } = require('../src/core/code-sender');
const signInTap = require('../src/web/sign-in-tap');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recorder() {
  const sent = [];
  return { sent, send: async (phone, text) => sent.push({ phone, text, at: Date.now() }) };
}

test('the code is not sent until the wait is over', async () => {
  const r = recorder();
  const sender = createCodeSender({ delayMs: 60, send: r.send });
  const asked = Date.now();

  await sender.schedule('+12015550100', '123456 is your code');
  assert.equal(r.sent.length, 0, 'sent before the wait');

  await wait(90);
  assert.equal(r.sent.length, 1);
  assert.ok(r.sent[0].at - asked >= 55, `sent after ${r.sent[0].at - asked}ms`);
});

test('asking again inside the wait sends ONE text, with the newest code', async () => {
  const r = recorder();
  const sender = createCodeSender({ delayMs: 50, send: r.send });

  await sender.schedule('+12015550100', '111111');
  await wait(20);
  await sender.schedule('+12015550100', '222222');
  await wait(80);

  assert.deepEqual(r.sent.map((s) => s.text), ['222222']);
});

test('two different numbers each get their own code', async () => {
  const r = recorder();
  const sender = createCodeSender({ delayMs: 30, send: r.send });

  await sender.schedule('+12015550100', 'aaa');
  await sender.schedule('+12015550101', 'bbb');
  await wait(60);

  assert.deepEqual(r.sent.map((s) => s.phone).sort(), ['+12015550100', '+12015550101']);
});

test('a deploy inside the wait still sends what is waiting', async () => {
  const r = recorder();
  const sender = createCodeSender({ delayMs: 10_000, send: r.send });

  await sender.schedule('+12015550100', '123456');
  assert.equal(r.sent.length, 0);

  await sender.flush();
  assert.equal(r.sent.length, 1, 'flush did not send the waiting code');
  assert.equal(sender.pendingCount(), 0);
});

test('a failed send is handed to the caller, never thrown', async () => {
  const failures = [];
  const sender = createCodeSender({
    delayMs: 0,
    send: async () => {
      throw new Error('carrier down');
    },
  });

  await sender.schedule('+12015550100', '123456', (err) => failures.push(err.message));
  assert.deepEqual(failures, ['carrier down']);
});

test('no wait configured sends at once, which is what the tests run with', async () => {
  const r = recorder();
  const sender = createCodeSender({ delayMs: 0, send: r.send });
  await sender.schedule('+12015550100', '123456');
  assert.equal(r.sent.length, 1);
});

test('the default wait is ten seconds on both sign-ins', () => {
  // Read the same way src/config.js reads it, so a changed default is caught.
  const { config } = require('../src/config');
  if (process.env.LOGIN_CODE_DELAY_MS == null) assert.equal(config.signIn.codeDelayMs, 10_000);
});

// ---------------------------------------------------------------------------
// THE TAP
// ---------------------------------------------------------------------------

test('a code sent without the tap mark is not a sign-in', () => {
  assert.equal(signInTap.wasTapped({ code: '123456' }), false);
  assert.equal(signInTap.wasTapped({ code: '123456', tapped: '' }), false);
  assert.equal(signInTap.wasTapped({ code: '123456', tapped: 'true' }), false);
  assert.equal(signInTap.wasTapped(undefined), false);
});

test('a code sent with the tap mark is', () => {
  assert.equal(signInTap.wasTapped({ code: '123456', tapped: 'yes' }), true);
});

test('the form carries an empty mark, and only a click on the button can fill it', () => {
  const html = signInTap.tapGate();
  assert.ok(html.includes('<input type="hidden" name="tapped" value="">'), 'the mark must start empty');
  assert.ok(html.includes("button.addEventListener('click'"), 'the mark is set by the button');
  assert.ok(html.includes('e.detail > 0'), 'a real click or tap is what counts');
  assert.ok(html.includes('e.preventDefault()'), 'a submit without the mark is stopped');
  assert.ok(!/\.submit\(\)|requestSubmit/.test(html), 'the page must never submit the form itself');
});

test('both code pages put the gate inside the form, on the Sign in button', () => {
  const admin = require('fs').readFileSync(require.resolve('../src/routes/admin.js'), 'utf8');
  const account = require('fs').readFileSync(require.resolve('../src/routes/account.js'), 'utf8');
  for (const [name, source] of [['/ops', admin], ['/account', account]]) {
    assert.ok(source.includes('data-sign-in'), `${name}: the Sign in button is not marked`);
    assert.ok(source.includes('signInTap.tapGate()'), `${name}: the gate is not on the page`);
    assert.ok(source.includes('signInTap.wasTapped(req.body)'), `${name}: the server does not check the tap`);
  }
});
