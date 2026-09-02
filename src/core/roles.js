'use strict';

// ---------------------------------------------------------------------------
// Who can see what in /ops.
//
// THIS FILE IS THE WHOLE ANSWER. If you find yourself writing
// `if (user.role === 'ADMIN')` in a page, stop and add a permission here
// instead — role checks scattered through templates are how a screen ends up
// showing a driver something it shouldn't.
//
// Pages ask `can(user, 'money.view')`. Roles map to permissions once, below.
// ---------------------------------------------------------------------------

// Every permission the system has. Adding a screen means adding a line here.
const PERMISSIONS = Object.freeze({
  'orders.view': 'See the orders board and individual orders',
  'orders.act': 'Move an order along — collected, weighed, delivered',
  // BEING A DRIVER IS NOT THE SAME AS DOING A DRIVER'S JOB, and conflating
  // them is what this permission exists to stop.
  //
  // An admin needs orders.act — correcting a weight somebody fat-fingered, or
  // marking an order delivered when a driver's phone died, is admin work. It
  // does not make them one of the people orders get handed to, and filtering
  // the driver pool on orders.act meant it did.
  //
  // A DRIVER holds this by role. An ADMIN holds it while they have switched it
  // on — see can(). Everything about rounds keys off it: the home base, the
  // assignment pool, the round strip, and /ops/run.
  'orders.drive': 'Be on the round: a home base, assigned orders, a day to drive',
  'customers.view': 'Browse customers and their history',
  // Every word anyone has ever texted us, including people who are not
  // customers. Kept separate from customers.view because a conversation holds
  // things a person said to what they thought was a person — complaints, where
  // they live, why they were out. Fewer people should be able to read that
  // than can look up an order.
  'messages.view': 'Read the text conversations',
  // Pausing the business, running promotions, texting everybody. Admin only,
  // and separate from team.manage because it is a different kind of authority:
  // one decides who works here, this one decides whether we are open and what
  // we give away.
  'service.manage': 'Open or close the service, run promotions, send a text blast',
  'partners.view': 'See partner enquiries',
  'partners.manage': 'Mark enquiries contacted or closed',
  'team.manage': 'Add people, change roles, switch people off',
  // Raised when the AI hands a conversation over. Holding this permission is
  // also what decides who gets TEXTED when one appears, so it is deliberately
  // not given to drivers: a ruined shirt is not theirs to answer at 11pm.
  'issues.manage': 'See and resolve customer issues, and be alerted to them',
  // Prices, payment status, what is owed, lifetime billed. Kept separate from
  // orders.view so a driver can do the round without seeing the books.
  'money.view': 'See prices and payment status',
  // The change log on an order — who moved it, what a weight was corrected
  // from, when a card was charged. It is the record of how the business
  // handled somebody, and it carries money, so it is not the driver's to
  // browse even though the driver is in it.
  'orders.audit': 'Read the change log on an order',

  // OVERRIDING A REFUSAL THE SYSTEM MADE FOR A REASON.
  //
  // Today that is one thing: the weight check when finished work is collected
  // off a laundromat. It refuses because a short load means a bag is probably
  // still on their shelf, and the counter is the one place that can be sorted
  // out. But it is a guess with a guessed threshold in it, and a driver stood
  // at a counter at six in the evening with a laundromat closing has to be able
  // to get past it.
  //
  // NOT the driver's, deliberately. The whole point of the check is that
  // somebody other than the person in a hurry decides it was fine - and the
  // override is written into the change log with a reason, so "we waved it
  // through" is a sentence with a name attached rather than a silent success.
  'orders.override': 'Push past a refusal the system made, on the record',

  // WRITING TO A REAL PHONE IS NOT READING A LIST. Separate from
  // messages.view for the same reason texting a laundromat the partner link
  // sits behind partners.manage: reading a thread is looking something up,
  // and sending one is an act that reaches somebody's pocket and cannot be
  // taken back.
  //
  // It is what lifts an AI hold. When the AI has stopped replying, somebody
  // holding this is the only way the customer hears anything at all.
  'messages.send': 'Text a customer directly from the conversation screen',
});

const ROLES = Object.freeze({
  ADMIN: {
    label: 'Admin',
    description: 'Everything. Can put themselves on the round when they want to.',
    // Everything except orders.drive, which is not the role's to grant - see
    // can() below. It used to be a bare Object.keys(PERMISSIONS), which quietly
    // handed every admin a home base and a place in the assignment pool, so
    // orders were being given to whoever was sitting at a desk.
    permissions: Object.keys(PERMISSIONS).filter((p) => p !== 'orders.drive'),
  },

  DRIVER: {
    label: 'Driver',
    description: "Today's work. No customer list, no money, no team.",
    // A driver needs the stop in front of them and the buttons to complete it:
    // where to go, when, how to get in, where the bag is, how many, and what it
    // weighed. Not the customer's name, not their phone, not the thread, not
    // the change log, not the money. The address is the one piece of somebody's
    // personal detail a driver gets, because you cannot drive to a stop without
    // it. Everything else is a file on a person, and a round does not need one.
    permissions: ['orders.view', 'orders.act', 'orders.drive'],
  },

  SALES: {
    label: 'Sales',
    description: 'Customers, conversations and partner enquiries. No money, no team.',
    // Sales gets the conversations because the useful ones are from numbers
    // that never signed up — someone who texted once and went quiet is the
    // warmest lead the business has, and nothing else surfaces them.
    permissions: [
      'orders.view',
      'customers.view',
      'messages.view',
      'issues.manage',
      'partners.view',
      'partners.manage',
      'orders.audit',
      // Sales works the conversations, including the ones the AI gave up on.
      'messages.send',
    ],
  },
});

const DEFAULT_ROLE = 'DRIVER';

function roleOf(user) {
  const role = user && user.role;
  return ROLES[role] ? role : DEFAULT_ROLE;
}

function can(user, permission) {
  // The machine key (x-admin-key) is not a person and has no role. It is only
  // ever used by our own scripts, so it gets everything.
  if (user && user.isMachine) return true;

  // THE ONE PERMISSION A ROLE DOES NOT DECIDE ON ITS OWN.
  //
  // A DRIVER always drives - that is the role. SALES never does. An ADMIN
  // drives only while they have switched it on, because in a business this
  // size the owner drives some days and not others, and that is something he
  // decides on a Tuesday morning rather than a property of his job title.
  //
  // The role check is here rather than in a page, which is exactly the rule at
  // the top of this file: this is where role logic belongs.
  if (permission === 'orders.drive' && roleOf(user) === 'ADMIN') {
    return Boolean(user && user.drives);
  }

  return ROLES[roleOf(user)].permissions.includes(permission);
}

function labelFor(role) {
  return (ROLES[role] || {}).label || role;
}

// Express middleware. Anyone without the permission gets a plain refusal
// rather than a redirect — they ARE signed in, they just aren't allowed here,
// and bouncing them to a sign-in page would be a confusing lie.
function requirePermission(permission, renderRefusal) {
  return (req, res, next) => {
    if (can(req.opsUser, permission)) return next();

    console.warn(
      `${req.opsUser && req.opsUser.name} (${roleOf(req.opsUser)}) was refused ${permission}`
    );
    return renderRefusal(req, res);
  };
}

module.exports = { PERMISSIONS, ROLES, DEFAULT_ROLE, can, roleOf, labelFor, requirePermission };
