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
  'customers.view': 'Browse customers and their history',
  // Every word anyone has ever texted us, including people who are not
  // customers. Kept separate from customers.view because a conversation holds
  // things a person said to what they thought was a person — complaints, where
  // they live, why they were out. Fewer people should be able to read that
  // than can look up an order.
  'messages.view': 'Read the text conversations',
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
});

const ROLES = Object.freeze({
  ADMIN: {
    label: 'Admin',
    // Everything, including the ability to change everyone else's role.
    description: 'Full access, including the team and the money.',
    permissions: Object.keys(PERMISSIONS),
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
    permissions: ['orders.view', 'orders.act'],
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
