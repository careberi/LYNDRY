'use strict';

const db = require('../db');

// ---------------------------------------------------------------------------
// A PHOTO OF WHERE THE BAG SITS.
//
// Neil's ask, 16 September: one still photo of the spot, taken with the phone
// camera, so the next driver knows which door.
//
// IT BELONGS TO THE CUSTOMER, NOT TO AN ORDER, and every other decision here
// follows from that. A delivery photo is evidence about one drop-off and
// belongs to that order for ever. This answers "which door, which side, behind
// which planter" - a fact about the ADDRESS, true of every pickup they will
// ever have. Hung off an order it would be retaken every week, and the one a
// new driver actually needs would be sitting on a row nobody is looking at.
//
// ONE PER CUSTOMER, REPLACED RATHER THAN APPENDED. It is the current answer to
// "which door", not a history of doors. The old file is deleted as the new one
// lands, so the bucket holds one object per customer rather than one per
// pickup for ever.
//
// IT IS NEVER TEXTED, NEVER LINKED, AND HAS NO PUBLIC PAGE. The delivery photo
// has /p/<order-uuid> precisely because the customer is meant to see it. This
// one is signed for a minute at a time off an ops route, for somebody already
// signed in. The customer knows where their own door is.
//
// A STILL PHOTO, NOT A STREAM. The same mechanism as the bag scan: a file
// input with capture="environment" opens the phone's own camera, with its
// autofocus and its exposure and its torch. No live video, no permission
// prompt of ours to refuse, nothing to keep alive.
// ---------------------------------------------------------------------------

// Private, like weight-photos and delivery-photos. A public bucket would put
// every customer's doorstep on a guessable URL.
const SPOT_PHOTO_BUCKET = 'spot-photos';

// How long a signed link lives. A minute is enough to redirect a browser at it
// and short enough that a URL copied out of the address bar is already dead.
const SIGNED_SECONDS = 60;

// What the camera is allowed to hand us. An oversize or wrong-typed file is a
// mistake rather than an attack, so it is refused with a sentence rather than
// thrown.
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];

function extensionFor(mimetype) {
  const raw = String(mimetype || '').split('/')[1] || 'jpg';
  return raw.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg';
}

// SAVE, THEN POINT AT IT, THEN TIDY UP THE OLD ONE - in that order.
//
// The upload happens before the row is written, the same way every other photo
// in this codebase does it: we would rather refuse the step than leave a
// customer row pointing at an object that silently failed to save.
//
// The old file is deleted LAST and its failure is swallowed. A leftover object
// costs a fraction of a penny; a customer row pointing at a file we deleted
// before the new one landed costs the driver the photo.
async function save(customerId, photo) {
  if (!customerId) return { ok: false, detail: 'No customer to attach that to.' };

  if (!photo || !photo.buffer || !photo.buffer.length) {
    return { ok: false, detail: 'No photo came through. Take one and try again.' };
  }

  if (photo.buffer.length > MAX_BYTES) {
    return { ok: false, detail: 'That photo is too large. Take another one.' };
  }

  if (photo.mimetype && !ALLOWED.includes(String(photo.mimetype).toLowerCase())) {
    return { ok: false, detail: `${photo.mimetype} is not a photo we can store.` };
  }

  const { data: customer, error: readError } = await db
    .from('customers')
    .select('id, pickup_spot_photo_path')
    .eq('id', customerId)
    .maybeSingle();

  if (readError) throw readError;
  if (!customer) return { ok: false, detail: 'No customer with that id.' };

  const previous = customer.pickup_spot_photo_path || null;
  const path = `${customerId}/spot-${Date.now()}.${extensionFor(photo.mimetype)}`;

  const { error: uploadError } = await db.storage
    .from(SPOT_PHOTO_BUCKET)
    .upload(path, photo.buffer, { contentType: photo.mimetype || 'image/jpeg', upsert: false });

  if (uploadError) {
    return { ok: false, detail: `The photo did not save (${uploadError.message}). Try again.` };
  }

  const takenAt = new Date().toISOString();

  const { error: writeError } = await db
    .from('customers')
    .update({ pickup_spot_photo_path: path, pickup_spot_photo_at: takenAt })
    .eq('id', customerId);

  if (writeError) {
    // The row still points at the old photo, which is the safe end to fail on.
    await db.storage
      .from(SPOT_PHOTO_BUCKET)
      .remove([path])
      .catch(() => {});
    throw writeError;
  }

  if (previous && previous !== path) {
    await db.storage
      .from(SPOT_PHOTO_BUCKET)
      .remove([previous])
      .catch((err) => console.error(`Could not remove the old spot photo: ${err.message}`));
  }

  return { ok: true, path, takenAt, replaced: Boolean(previous) };
}

// A link that works for a minute, for a browser that is already signed in to
// ops. Null rather than a throw when there is no photo: "no photo" is the
// ordinary state for every customer who has never had one taken.
async function signedUrl(path) {
  if (!path) return null;

  const { data, error } = await db.storage
    .from(SPOT_PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_SECONDS);

  if (error) {
    console.error(`Could not sign a spot photo: ${error.message}`);
    return null;
  }

  return data ? data.signedUrl : null;
}

// Has this customer got one. Reads the column rather than asking storage, so a
// screen can decide whether to draw the card without a network call.
//
// AN UNSELECTED COLUMN READS AS undefined HERE, which is indistinguishable
// from "no photo" - so this answers false and the card is simply not drawn.
// That is the safe direction for a convenience, and it is why the column is
// named in RUN_FIELDS rather than left to chance.
function has(customer) {
  return Boolean(customer && customer.pickup_spot_photo_path);
}

module.exports = { save, signedUrl, has, SPOT_PHOTO_BUCKET, MAX_BYTES, ALLOWED };
