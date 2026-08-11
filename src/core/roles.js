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
  'partners.view': 'See partner enquiries',
  'partners.manage': 'Mark enquiries contacted or closed',
  'team.manage': 'Add people, change roles, switch people off',
  // Prices, payment status, what is owed, lifetime billed. Kept separate from
  // orders.view so a driver can do the round without seeing the books.
  'money.view': 'See prices and payment status',
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
    // A driver needs the stop in front of them and the buttons to complete it.
    // They see a customer's address and phone on the order they are working —
    // that is the job — but cannot browse everyone, and cannot see prices.
    permissions: ['orders.view', 'orders.act'],
  },

  SALES: {
    label: 'Sales',
    description: 'Customers and partner enquiries. No money, no team.',
    permissions: ['orders.view', 'customers.view', 'partners.view', 'partners.manage'],
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
