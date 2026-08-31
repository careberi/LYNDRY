'use strict';

// ---------------------------------------------------------------------------
// Read a whole conversation the way a customer experiences it.
//
//   npm run check:thread
//
// THE POINT IS THE TURNS, NOT THE MESSAGES. Testing replies one at a time
// says nothing about what a thread FEELS like, and the fault it misses is the
// one real customers actually notice: every reply ending with the same
// sentence. Neil spotted it on a live thread where three answers in a row all
// finished with "we have not launched yet, we will let you know", and every
// single one of them passed a per-message check.
//
// Creates one customer through the real front door and deletes it afterwards.
// Nothing is texted: decide() returns the reply, the SMS route is what sends.
// ---------------------------------------------------------------------------

const ROOT = require('path').join(__dirname, '..', 'src') + require('path').sep;

const db = require(ROOT + 'db');
const brain = require(ROOT + 'core/brain');
const actions = require(ROOT + 'core/actions');
const onboarding = require(ROOT + 'core/onboarding');
const promotions = require(ROOT + 'core/promotions');

const TURNS = ['6105 nightrose ct', 'Thanks', 'How does it work', 'ok cool', 'when do you open'];

// The disclaimer, however it gets phrased.
const NEWS = /(not|haven'?t|have not).{0,30}(launch|open|booking|taking pickups)|we'?ll let you know|let you know the moment|when we (open|launch)|up and running/i;

(async () => {
  let id = null;
  try {
    const started = await onboarding.startConversation({
      phone: '+12015554242', consentSource: 'INBOUND_TEXT', sendWelcome: false,
    });
    const c = started.customer;
    id = c.id;
    const held = await promotions.heldBy(c.id).catch(() => []);

    const history = [];
    let saidNews = 0;

    for (const message of TURNS) {
      const out = await brain.decide({
        customer: { ...c, preferences: {}, orders: [], schedules: [], promotions: held },
        order: null, recentMessages: history, recentOrders: [], openIssue: null,
        message, followUp: null,
      }).catch((e) => ({ type: 'error', text: e.message }));

      let reply = out.type === 'text' ? out.text : await actions.run(out.name, out.input, c);

      const repeats = NEWS.test(String(reply));
      if (repeats) saidNews += 1;

      console.log(`\n  > ${message}`);
      console.log(`    ${String(reply).replace(/\n/g, '\n    ')}`);
      if (repeats) console.log(`    [carries the not-open news]`);

      history.push({ direction: 'INBOUND', body: message });
      history.push({ direction: 'OUTBOUND', body: String(reply) });
    }

    console.log(`\n  The news appears in ${saidNews} of ${TURNS.length} replies.`);
    console.log(`  ${saidNews <= 2 ? 'Reads like a person.' : 'STILL REPETITIVE'}`);
  } catch (e) {
    console.log('THREW:', e.message || JSON.stringify(e));
  }
  if (id) {
    await db.from('customer_promotions').delete().eq('customer_id', id);
    await db.from('messages').delete().eq('customer_id', id);
    await db.from('customers').delete().eq('id', id);
  }
  process.exit(0);
})();
