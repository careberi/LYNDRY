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

const db = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: {
    // This is a server. There is no logged-in user and no session to keep.
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = db;
