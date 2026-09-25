'use strict';

const { config } = require('../../config');

// ---------------------------------------------------------------------------
// The courier interface.
//
// Nothing outside this folder knows Uber exists, exactly as nothing outside
// src/providers/sms/ knows Telnyx does. Everything else asks for these:
//
//   quote({ from, to, ... })        what would this trip cost, and how long
//   book({ ... })                   send a courier, get back an id and a PIN
//   status(deliveryId)              where is it
//   cancel(deliveryId)              call it off
//   parseWebhook(body)              turn their event into our shape
//   verifySignature({ rawBody, headers })   is this really from them
//
// THE POINT IS BEING ABLE TO SWITCH IN AN AFTERNOON. Uber Direct is not the
// only courier network, its terms for collecting from a customer's home are
// ambiguous, and the whole business now depends on somebody else's driver.
// A second file beside uber.js is the answer to all three.
//
// AND IT IS WHAT LETS THE WHOLE FLOW BE BUILT BEFORE THE ACCOUNT EXISTS. The
// fake courier below is not a stub: it quotes from the real band table, issues
// a real-shaped PIN, and can be walked through every status a real delivery
// goes through. An order can be driven from booking to doorstep in development
// with nobody driving anywhere, which is the only way to find out what the
// screens need before committing to them.
// ---------------------------------------------------------------------------

const uber = require('./uber');
const fake = require('./fake');

// Used where couriers are not configured at all - the same shape as the SMS
// provider's `disabled`. It refuses rather than pretending, because a booking
// that silently did nothing would put a customer's laundry on a doorstep with
// nobody coming for it.
const disabled = {
  name: 'disabled',
  configured: false,
  quote: async () => {
    throw new Error('No courier is configured: UBER_CUSTOMER_ID, UBER_CLIENT_ID and UBER_CLIENT_SECRET are missing.');
  },
  book: async () => {
    throw new Error('No courier is configured, so nothing can be sent to collect an order.');
  },
  status: async () => null,
  cancel: async () => {
    throw new Error('No courier is configured.');
  },
  parseWebhook: () => null,
  verifySignature: () => false,
};

// WHICH ONE, as a rule with nothing behind it - the same shape the SMS driver
// choice uses, and pinned by a test for the same reason.
//
// `realData` IS THE THIRD QUESTION AND IT IS NOT `production`. The deployed
// development site runs with NODE_ENV=production on purpose so that it behaves
// like production. An environment check alone would let it send a real courier
// to a seeded customer's invented address - a real person driving to a house
// that does not exist, and a real charge for the trip.
function pick({ configured, production, realData }) {
  if (configured && production && realData) return 'uber';
  if (configured) return 'uber-test';
  return production && realData ? 'disabled' : 'fake';
}

const DRIVERS = { uber, 'uber-test': uber.testMode, disabled, fake };

function choose() {
  const configured = Boolean(
    config.uber.customerId && config.uber.clientId && config.uber.clientSecret
  );
  const production = config.env === 'production';
  const name = pick({ configured, production, realData: config.supabase.isProduction });

  if (name === 'uber-test') {
    console.warn(
      'Uber credentials are set but this is not the live business: using Uber TEST mode. ' +
        'No courier is dispatched and nothing is charged.'
    );
  }

  if (name === 'disabled') {
    console.warn(
      'NO COURIER CONFIGURED. Pickups cannot be booked until UBER_CUSTOMER_ID, ' +
        'UBER_CLIENT_ID and UBER_CLIENT_SECRET are set.'
    );
  }

  return DRIVERS[name];
}

const driver = choose();

module.exports = {
  name: driver.name,
  // "Nothing this books puts a real driver on a real road." True of the fake
  // one, of Uber's test mode and of the refusing one. Asked as "is it the live
  // Uber driver", so a courier added later is assumed real until it says
  // otherwise - the safe direction for a question whose wrong answer is
  // somebody driving to a house that does not exist.
  isFake: driver !== uber,
  configured: driver.configured !== false,

  quote: (...args) => driver.quote(...args),
  book: (...args) => driver.book(...args),
  status: (...args) => driver.status(...args),
  cancel: (...args) => driver.cancel(...args),
  parseWebhook: (...args) => driver.parseWebhook(...args),
  verifySignature: (...args) => driver.verifySignature(...args),

  // Exposed for the test that pins which courier each situation gets, and for
  // the development script that walks a fake delivery forward.
  pick,
  fake,
};
