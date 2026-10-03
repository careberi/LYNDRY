'use strict';

const { config } = require('../config');
const partners = require('./partners');
const staff = require('./partner-staff');
const notify = require('./notify');
const { normalisePhone } = require('./phone');

function urlFor(partner) {
  if (partner?.type !== 'LAUNDROMAT' || !partner.slug) return null;
  // /shop belongs to the public host, not the POS host's ops routes.
  return `${config.baseUrl}/shop/${encodeURIComponent(partner.slug)}`;
}

async function prepare(partner) {
  if (!partner || partner.type !== 'LAUNDROMAT' || partner.slug) return partner;
  // Imports and older records can bypass create/update, which normally assign it.
  const slug = await partners.ensureSlug(partner).catch(err => {
    console.error(`Could not prepare portal address for ${partner.id}: ${err.message}`);
    return null;
  });
  return slug ? { ...partner, slug } : partner;
}

async function send({ partnerId, userId, sentBy = null }) {
  const partner = await partners.find(partnerId);
  if (!partner || partner.type !== 'LAUNDROMAT' || partner.status !== 'ACTIVE') {
    return { sent: false, refused: 'unavailable_shop' };
  }
  const person = (await staff.list(partnerId)).find(p => p.id === userId && p.partner_id === partnerId);
  if (!person || person.status !== 'ACTIVE') return { sent: false, refused: 'unavailable_staff' };
  const phone = normalisePhone(person.phone);
  if (!phone) return { sent: false, refused: 'bad_phone' };
  const url = urlFor(await prepare(partner));
  if (!url) return { sent: false, refused: 'missing_url' };
  const text = `LYNDRY portal for ${partner.name}:\n${url}\nSign in with your mobile number to receive a code.`;
  // Preserve the shared sender's development prefix, opt-out checks and log.
  const result = await notify.sendAndLog(phone, text, null, { sentBy });
  return { ...result, phone };
}

module.exports = { urlFor, prepare, send };
