'use strict';
const db = require('../db');
const { config } = require('../config');
const { sameOrigin } = require('./spending-routes');
const { escapeHtml: e } = require('../web/layout');

function control(person, mayEdit) {
  if (!config.supabase.isDevelopment) return '';
  const wholesale = person.pricing_category === 'WHOLESALE';
  if (!mayEdit) return wholesale ? '<span class="badge">Wholesale customer</span>' : '';
  return `<form method="post" action="/ops/customers/${e(person.id)}/pricing-category">
    <input type="hidden" name="expected" value="${wholesale ? 'WHOLESALE' : 'ONE_TIME'}">
    <input type="hidden" name="category" value="${wholesale ? 'ONE_TIME' : 'WHOLESALE'}">
    <button type="submit" role="switch" aria-checked="${wholesale}" aria-label="Wholesale customer" class="btn btn-outline btn-sm">Wholesale customer: ${wholesale ? 'On' : 'Off'}</button>
    <small>Applies to new quotes for one-time and subscription pickups.</small>
  </form>`;
}

function registerAdmin(router, { guard, may }) {
  router.post('/ops/customers/:id/pricing-category', guard, may('service.manage'),
    (req,res,next) => config.supabase.isDevelopment ? next() : res.sendStatus(404), sameOrigin,
    async (req,res) => {
      if (!/^[a-f0-9-]{36}$/i.test(req.params.id || '')) return res.sendStatus(404);
      const back = '/ops/customers/' + req.params.id;
      try {
        const { category, expected } = req.body || {};
        if (![category,expected].every(v => ['ONE_TIME','WHOLESALE'].includes(v))) throw Error('Choose a valid customer pricing setting.');
        const { data, error } = await db.from('customers').update({ pricing_category: category })
          .eq('id',req.params.id).eq('pricing_category',expected).select('id').maybeSingle();
        if (error) throw error;
        if (!data) throw Error('The customer setting changed. Refresh the page and try again.');
        res.redirect(303,back+'?note='+encodeURIComponent(category === 'WHOLESALE'
          ? 'Wholesale pricing is on for new one-time and subscription quotes. Existing orders keep their prices.'
          : 'Standard pricing is on for new quotes. Existing orders keep their prices.'));
      } catch (error) { res.redirect(303,back+'?problem='+encodeURIComponent(error.message)); }
    });
}
module.exports = { control, registerAdmin };
