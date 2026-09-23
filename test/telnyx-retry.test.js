'use strict';

const test = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// A TEXT IS TRIED AGAIN WHEN TELNYX IS THE ONE FAILING, AND NEVER WHEN IT SAID NO.
//
// 23 September: Telnyx's messaging API returned intermittent 504s for over an
// hour, we tried every text once, and nothing - customer texts or sign-in codes
// - reached a phone. See the note at the top of src/providers/sms/telnyx.js.
//
// These stub fetch, so nothing here touches the network. The backoff is real,
// which is why there are only three scenarios: each retry costs a second or
// three of wall clock.
// ---------------------------------------------------------------------------

const telnyx = require('../src/providers/sms/telnyx');

const realFetch = global.fetch;

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

// Answers the calls in order, and counts them.
function scripted(...answers) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push(init);
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return calls;
}

test.afterEach(() => {
  global.fetch = realFetch;
});

test('a 504 is tried again, and the text goes out on the second try', async () => {
  const calls = scripted(
    reply(504, '<html><head><title>telnyx.com | 504: Gateway time-out</title></head></html>'),
    reply(200, { data: { id: 'msg-123' } })
  );

  const result = await telnyx.sendMessage({ to: '+12015550199', text: 'hello' });

  assert.equal(result.providerMessageId, 'msg-123');
  assert.equal(calls.length, 2, 'it did not try again after the 504');
});

test('a real refusal is final: a 4xx is never sent twice', async () => {
  // THE CASE THAT MUST NOT RETRY. A 4xx is Telnyx saying this message cannot
  // go - an opted-out handset among them - and sending it again is the one
  // thing the carrier rules forbid.
  const calls = scripted(reply(400, { errors: [{ code: '40300', title: 'Invalid destination' }] }));

  await assert.rejects(
    telnyx.sendMessage({ to: '+12015550199', text: 'hello' }),
    /HTTP 400, try 1 of 3/
  );
  assert.equal(calls.length, 1, 'a 400 was sent again');
});

test('a hard outage still ends, and the error is one readable line', async () => {
  // Three tries and then the caller gets the error, exactly as before - which
  // is what puts a staff sign-in code into the server log.
  const page =
    '<!DOCTYPE html>\n<html><head>\n<title>telnyx.com | 504: Gateway time-out</title>\n</head>' +
    '<body>' + '<div>cloudflare furniture</div>\n'.repeat(200) + '</body></html>';
  const calls = scripted(reply(504, page));

  await assert.rejects(telnyx.sendMessage({ to: '+12015550199', text: 'hello' }), (err) => {
    assert.match(err.message, /HTTP 504, try 3 of 3/);
    // NOT THE WEB PAGE. The whole Cloudflare page used to go into the log and
    // bury the one line anybody needed from it.
    assert.ok(err.message.includes('telnyx.com | 504: Gateway time-out'), err.message);
    assert.ok(!err.message.includes('cloudflare furniture'), 'the page body leaked into the error');
    assert.ok(!err.message.includes('\n'), 'the error is more than one line');
    return true;
  });
  assert.equal(calls.length, telnyx.ATTEMPTS, 'it did not stop at the limit');
});
