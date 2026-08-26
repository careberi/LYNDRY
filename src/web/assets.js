'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Cache-busting for the stylesheets.
//
// THE PROBLEM THIS SOLVES, because it cost a real afternoon:
//
// The stylesheets used to be served from /css with a seven-day cache. HTML is
// never cached, so after a deploy a returning visitor got the NEW markup with
// the OLD stylesheet — and a browser with a fresh copy in its cache doesn't
// even ask whether there's a newer one until the seven days are up. The logo
// shipped as unstyled markup on every phone that had visited before, and there
// was nothing to do about it from the server.
//
// The fix is to put a fingerprint of the CSS in the URL. Change any stylesheet
// and every URL changes with it, so browsers fetch the new file immediately.
// Because a given URL's content can then never change, it is safe to cache it
// hard and forever.
//
// The fingerprint is a directory path rather than a ?query, on purpose: the
// design system's styles.css pulls in its token files with relative @import,
// and those imports resolve under whatever directory the stylesheet was loaded
// from. Versioning the directory therefore versions the imports too. A query
// string would not — the tokens would stay stale.
// ---------------------------------------------------------------------------

const CSS_DIR = path.join(__dirname, '..', '..', 'public', 'css');

// EVERY file under public/css, sorted, so the hash is stable across machines
// and across restarts rather than depending on the order the disk hands them
// back.
//
// Every file, not only the .css ones, and that matters now the logo lives here
// as an image. This directory is served with a year-long immutable cache, so a
// file whose contents are not in the fingerprint can never reach anybody who
// has visited before - which is precisely the bug the fingerprint was built to
// stop, and it would have come back the first time the logo changed.
function assetFiles(dir) {
  const found = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...assetFiles(full));
    else found.push(full);
  }

  return found.sort();
}

function fingerprint() {
  const hash = crypto.createHash('sha1');

  try {
    for (const file of assetFiles(CSS_DIR)) {
      // The path goes in as well as the contents, so renaming a file changes
      // the fingerprint even if nothing inside it did.
      hash.update(path.relative(CSS_DIR, file));
      hash.update(fs.readFileSync(file));
    }
  } catch (err) {
    // A missing stylesheet is a much bigger problem than a stale cache, and
    // it will announce itself the moment a page renders. Don't crash here.
    console.error('Could not fingerprint the stylesheets:', err.message);
    return 'dev';
  }

  return hash.digest('hex').slice(0, 10);
}

// Computed once, at startup. The dev server restarts on every file change, so
// editing a stylesheet still produces a new fingerprint immediately.
const CSS_BUILD = fingerprint();

// Where a page should link its stylesheets.
const CSS_BASE = `/css/${CSS_BUILD}`;

module.exports = { CSS_DIR, CSS_BUILD, CSS_BASE };
