'use strict';

const fs = require('fs');
const path = require('path');
const { site } = require('./site');

// ---------------------------------------------------------------------------
// THE CONTACT CARD, so somebody can save our number with the logo on it.
//
// Tapping a link to this on a phone opens the "Add Contact" sheet with the name,
// the number and the mark already filled in. That is worth more than it sounds
// before launch: a text from a number nobody has saved reads as spam, and a
// number that shows up as LYNDRY with a logo does not.
//
// ASSEMBLED IN MEMORY AND CACHED, like the QR code in site.js: built once on
// the first request and reused, with the name, the number and the service area
// read from site.js rather than typed out again here. Change the number in one
// place and the contact card follows.
//
// The photo it embeds is the one thing that is a file - see below for why.
//
// WHY THIS IS A LINK AND NOT AN ATTACHMENT. Sending the file itself needs MMS,
// and this system has never sent one - the Telnyx adapter takes { to, text }
// and nothing else, and MMS needs provisioning on the messaging profile on top
// of the 10DLC campaign. A texted link on lyndry.com is also the rule the rest
// of the system already follows, for carrier trust: see the delivery photos.
// ---------------------------------------------------------------------------

// THE PHOTO IS A FILE, NOT SOMETHING BUILT AT RUNTIME, and that is a departure
// from the QR code worth explaining. Compositing the mark onto a square ground
// needs an image library - sharp - which is a native dependency with
// platform-specific binaries and a real build cost on every deploy. That is a
// lot to carry for one picture that only changes when the logo does.
//
// So it is composited once, by hand, and committed: the mark from
// public/css/logo.png at 356px, centred on a 512px square of --suds-500.
//
// THE TWO NUMBERS ARE THE INTERESTING PART. A phone crops a contact photo to a
// circle, so 356 on 512 puts the mark's diagonal at about 482px - comfortably
// inside the 512px circle. Wider and the corners of the bag get clipped. And
// the ground is the brand green rather than transparency, because a transparent
// photo sits on whatever the handset paints behind it, which is white in light
// mode and near-black in dark, and the mark's ink outline vanishes into one of
// them.
//
// If the logo is ever replaced, rebuild this with the snippet in DECISIONS.md.
const PHOTO = path.join(__dirname, 'contact-photo.jpg');

let cached = null;

// Fold to 75 octets with a leading space on continuations, per RFC 6350.
// An unfolded base64 photo is one line tens of thousands of characters long,
// which is exactly what a strict parser refuses to read.
function fold(line) {
  const out = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest) {
    out.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return out;
}

// The photo, base64'd. Null if it cannot be read - a card with no picture is
// still a working contact card, and a missing file must never be the reason
// somebody cannot save the number.
function photo() {
  try {
    return fs.readFileSync(PHOTO).toString('base64');
  } catch (err) {
    console.error(`Could not read the contact photo: ${err.message}`);
    return null;
  }
}

function build() {
  const jpeg = photo();

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    // N is required by 3.0 even for a business. The name sits in the given-name
    // slot so a phone that builds its display name from N rather than FN still
    // shows LYNDRY rather than a blank.
    `N:;${site.name};;;`,
    `FN:${site.name}`,
    `ORG:${site.name}`,
    // Files it as a company, so iOS does not show it under a first name.
    'X-ABShowAs:COMPANY',
    `TEL;TYPE=CELL,VOICE,PREF:${site.publicPhoneLink}`,
    'URL:https://lyndry.com',
    `NOTE:Laundry pickup and delivery in ${site.serviceArea}. Text this number to book a pickup.`,
  ];

  if (jpeg) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${jpeg}`);

  lines.push('END:VCARD');

  // CRLF, which the spec asks for and some Android clients insist on.
  return `${lines.flatMap(fold).join('\r\n')}\r\n`;
}

// The card, built once and reused.
function card() {
  if (!cached) cached = build();
  return cached;
}

module.exports = { card };
