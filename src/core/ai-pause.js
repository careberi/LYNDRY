'use strict';

const db = require('../db');
const issues = require('./issues');

// ---------------------------------------------------------------------------
// A PERSON HAS TAKEN THIS CONVERSATION OVER.
//
// Neil's call. Something goes wrong in a thread, an admin wants to deal with
// the customer themselves, and the AI has to get out of the way completely -
// not soften its answers, not hedge, say nothing at all - until they are done.
//
// THIS IS NOT THE SAME THING AS THE HOLD IN issues.js, and the difference is
// the whole reason it exists. The hold is the AI admitting it has run out of
// road: it goes quiet and then lifts ITSELF as soon as a person has replied and
// the customer has answered, which is right, because the AI gave up over one
// stuck exchange and the conversation has plainly moved on.
//
// That release is exactly wrong for somebody handling a customer by hand. They
// send a message, the customer replies, and the AI would come straight back
// in - in the middle of the conversation they were having. So this is a switch
// with a person at both ends: off when they say, on when they say, and nothing
// the customer does moves it.
//
//   the hold   the AI ran out of road and is waiting to be rescued
//   the pause  somebody has this one, hands off
//
// Keyed on the phone number rather than the customer, because the screen it
// lives on is a list of numbers and some of them never signed up.
// ---------------------------------------------------------------------------

// Is the AI muted on this number?
//
// FAILS CLOSED, and that is deliberate. If we cannot read the switch we do not
// know whether somebody is mid-conversation with this customer, and the AI
// talking over a person handling a complaint is worse than a message going
// unanswered for a minute. In practice a failure here means the database is
// unreachable, in which case the reply was never going to be written anyway -
// so this costs nothing and protects the case that matters. It shouts, because
// silence that nobody can explain is its own problem.
async function isPaused(phone) {
  const { data, error } = await db
    .from('ai_pauses')
    .select('paused')
    .eq('phone', phone)
    .maybeSingle();

  if (error) {
    console.error(
      `Could not read the AI pause for ${phone}: ${error.message}. ` +
        'Saying nothing rather than risk talking over somebody.'
    );
    return true;
  }

  return Boolean(data && data.paused);
}

// The whole row, or null. The thread page uses this rather than isPaused()
// because it wants to say who took it over and when, and it says that after
// they have handed it back as well.
async function stateFor(phone) {
  const { data, error } = await db
    .from('ai_pauses')
    .select('phone, paused, paused_at, paused_by, resumed_at, resumed_by, note')
    .eq('phone', phone)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // Who, by name. Two separate lookups on the same table cannot be expressed
  // as one Supabase join without naming both foreign keys, and this is a page
  // that renders one row - so it is one small query rather than a clever one.
  const ids = [data.paused_by, data.resumed_by].filter(Boolean);

  if (ids.length) {
    const { data: people } = await db.from('ops_users').select('id, name').in('id', ids);
    const byId = new Map((people || []).map((u) => [u.id, u.name]));
    data.paused_by_name = byId.get(data.paused_by) || null;
    data.resumed_by_name = byId.get(data.resumed_by) || null;
  }

  return data;
}

// Which of these numbers are muted. One query for the conversations list, so
// the list does not fire a lookup per row.
async function pausedAmong(phones) {
  const wanted = [...new Set((phones || []).filter(Boolean))];
  if (!wanted.length) return new Set();

  const { data, error } = await db
    .from('ai_pauses')
    .select('phone')
    .eq('paused', true)
    .in('phone', wanted);

  if (error) throw error;
  return new Set((data || []).map((r) => r.phone));
}

// The machine key is not a person and has no row to point at, the same way it
// resolves an issue as nobody.
function actorId(opsUser) {
  return opsUser && !opsUser.isMachine ? opsUser.id : null;
}

// Switch the AI off for this number.
async function pause(phone, opsUser, note) {
  const { data, error } = await db
    .from('ai_pauses')
    .upsert(
      {
        phone,
        paused: true,
        paused_at: new Date().toISOString(),
        paused_by: actorId(opsUser),
        // Cleared, so a page never shows last month's handback next to a pause
        // that went on this morning.
        resumed_at: null,
        resumed_by: null,
        note: note ? String(note).slice(0, 200) : null,
      },
      { onConflict: 'phone' }
    )
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// Hand it back.
//
// THIS ALSO LIFTS AN AUTOMATIC HOLD, and it has to. The two mute the AI
// independently, so an admin who switches the pause back on while a hold is
// still open would watch the AI stay silent and reasonably conclude the button
// did nothing. A person saying "the AI can take this again" is a stronger
// statement than the hold's own release condition, which is only a guess that
// the conversation has resumed.
//
// It lives here rather than in the route so that a second caller cannot forget
// it - the same rule the fulfilment steps follow.
async function resume(phone, opsUser) {
  const { data, error } = await db
    .from('ai_pauses')
    .update({
      paused: false,
      resumed_at: new Date().toISOString(),
      resumed_by: actorId(opsUser),
    })
    .eq('phone', phone)
    .select('*')
    .maybeSingle();

  if (error) throw error;

  // Best effort, and loud if it fails. The switch itself is already off; a
  // hold we could not clear is a thing to fix, not a reason to refuse the
  // handback and leave the customer with nobody talking to them at all.
  let liftedHold = false;

  try {
    const { data: customer } = await db
      .from('customers')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (customer) {
      const hold = await issues.holdFor(customer.id);

      if (hold) {
        await issues.resolve(
          hold.id,
          opsUser,
          'Handled by a person, who then handed the conversation back to the AI.'
        );
        liftedHold = true;
      }
    }
  } catch (err) {
    console.error(`Let the AI back into ${phone} but could not lift its hold: ${err.message}`);
  }

  return { row: data || null, liftedHold };
}

module.exports = { isPaused, stateFor, pausedAmong, pause, resume };
