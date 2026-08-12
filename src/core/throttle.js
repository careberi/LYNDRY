'use strict';

// ---------------------------------------------------------------------------
// Simple in-memory rate limiting.
//
// Deliberately not clever. Counters live in a Map, they reset when the server
// restarts, and they are per-instance. That is fine for one small server and
// far better than nothing. If this ever runs on more than one instance they
// have to move into the database, because two instances each allowing "five
// per number" allows ten.
//
// This lives in its own file because more than one thing needs it now: the
// sign-in codes, and the hero form on the home page that texts a stranger
// whatever number was typed into it. Both are public and both send SMS, which
// costs money and annoys people if abused.
// ---------------------------------------------------------------------------

const buckets = new Map();

// Records an attempt against `key`. Returns true if the caller has gone OVER
// the limit and should be refused.
function hit(key, limit, windowMs) {
  const now = Date.now();
  const record = buckets.get(key);

  if (!record || now > record.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  record.count += 1;
  return record.count > limit;
}

function clearBucket(key) {
  buckets.delete(key);
}

module.exports = { hit, clearBucket };
