'use strict';

const { createClient } = require('@supabase/supabase-js');
const { config } = require('./config');

// ---------------------------------------------------------------------------
// The database connection.
//
// We connect with the service_role key, which bypasses Supabase's row level
// security. That is correct here: this is a private server, there is no
// browser talking to the database directly, and every table has RLS switched
// on with no policies, so the service_role key is the only way in.
//
// The flip side is that this key has no restrictions at all. It belongs in
// .env and on the server, and nowhere else — never in a web page, never in a
// message, never in a commit.
// ---------------------------------------------------------------------------

if (!config.supabase.url || !config.supabase.serviceRoleKey) {
  throw new Error(
    'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
      'in your .env file — see .env.example for where to find them.'
  );
}

// ---------------------------------------------------------------------------
// THE CONNECTION REFUSES ITSELF RATHER THAN BEING ASKED NICELY.
//
// Until 25 September nothing in this system knew which database it was talking
// to. A dozen places asked "am I in production", and every one of them guarded
// a timer or a tracking pixel - never the rows. So a laptop was a fully
// privileged production node, and the only thing keeping it honest was whoever
// was typing remembering which .env was in place. That failed once already:
// order #2073, where a sandbox Stripe key met a live card and the customer was
// recorded as having been REFUSED.
//
// IT REFUSES ON A POSITIVE MATCH, AND THAT DIRECTION IS LOAD-BEARING. The test
// is "this IS the production project AND this is NOT production" - never
// "I don't recognise this project". Written the other way round, the day
// somebody restores production into a new project ref, this line would refuse
// to boot the real server and the guard would become the outage.
//
// `--live` IS THE DELIBERATE WAY THROUGH, typed per command, never stored. See
// the note at the top of config.js for why it is an argument and not a setting.
// ---------------------------------------------------------------------------
if (config.supabase.isProduction && config.env !== 'production' && !config.live) {
  throw new Error(
    'REFUSED: this is the PRODUCTION database and this is not production.\n' +
      `  database    : ${config.supabase.projectRef}\n` +
      `  environment : ${config.env}\n\n` +
      'Nothing has been read or written. If you meant to touch the real business,\n' +
      'add --live to the command. If you did not, your .env is pointed at the\n' +
      'wrong project.'
  );
}

const db = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: {
    // This is a server. There is no logged-in user and no session to keep.
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = db;
