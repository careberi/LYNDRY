'use strict';

const db = require('../db');
const checkout = require('../core/dev-checkout');
const economics = require('../core/pricing-economics');
const holds = require('../core/card-hold-policy');
const { escapeHtml: e } = require('../web/layout');
const { sameOrigin } = require('./spending-routes');

function updatedPolicy(current, form, actor) {
  const marginBps = Object.fromEntries(economics.CATEGORIES.map(key => {
    const value = String(form[key] ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error('Enter each margin percentage with no more than two decimal places.');
    return [key, Math.round(Number(value) * 100)];
  }));
  const loadingBufferMinutes=require('../core/pickup-timing').bufferMinutes(form.loading_buffer_minutes??current.loadingBufferMinutes??10);
  const result = { ...current, marginBps, cardHold: holds.fromForm(form), loadingBufferMinutes, changedBy: actor };
  delete result.version;
  for (const key of economics.CATEGORIES) economics.validatePolicy(result, key);
  return result;
}

function settingsBody(policy, { notice = '', problem = '' } = {}) {
  const hold = policy.cardHold || { mode: 'FIXED', fixedCents: require('../core/quote').holdCents() };
  return `<h1>Pricing and card holds</h1>
    ${notice ? `<p role="status">${e(notice)}</p>` : ''}${problem ? `<p role="alert">${e(problem)}</p>` : ''}
    <p>Changes apply to new quotes. Existing accepted quotes and card holds keep their saved amounts.</p>
    <form method="post" action="/ops/pricing" class="ops-form-stack">
      <section class="card card-xl"><h2>Margin after direct costs</h2>
        <p>The percentage remaining after washing, courier and payment-processing costs. Other business expenses are excluded, so this is not net profit.</p>
        ${economics.CATEGORIES.map(key => `<label>${e({ ONE_TIME: 'One-time pickup', SUBSCRIPTION: 'Subscription', WHOLESALE: 'Wholesale' }[key])} (%)<input name="${key}" type="number" min="0" max="99.99" step="0.01" value="${policy.marginBps[key] / 100}" required></label>`).join('')}
      </section>
      <section class="card card-xl"><h2>Card authorization hold</h2>
        <p>A temporary hold, not an additional charge. The final bill still uses the actual laundry weight.</p>
        <label>Hold amount<select name="hold_mode">${[['FIXED','Fixed dollar amount'],['MINIMUM','Order minimum total'],['MAXIMUM','Order maximum total (50 lb)']].map(([value,label]) => `<option value="${value}"${hold.mode === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Fixed amount ($)<input name="hold_fixed" type="number" min="0.50" max="10000" step="0.01" value="${hold.fixedCents == null ? '' : (hold.fixedCents / 100).toFixed(2)}"></label>
        <p>Fixed amount is used only when selected. Minimum and maximum use each order’s saved price, including its operational fee.</p>
      </section><section class="card card-xl"><h2>In-house pickup timing</h2><label>Loading buffer (minutes)<input name="loading_buffer_minutes" type="number" min="0" max="120" step="1" value="${policy.loadingBufferMinutes??10}" required></label><p>Added to estimated travel time for new quotes. Existing orders retain their quoted buffer.</p></section><button class="btn btn-primary">Save pricing and card holds</button>
    </form>`;
}

function registerAdmin(router, { guard, may, adminPage }) {
  const dev = (req,res,next) => checkout.enabled ? next() : res.sendStatus(404);
  router.get('/ops/pricing', guard, may('service.manage'), dev, async (req,res,next) => {
    try { res.type('html').send(adminPage({ title: 'Pricing and card holds', active: '/ops/admin', terminal: true, user: req.opsUser,
      body: settingsBody(await checkout.policy(), { notice: req.query.notice, problem: req.query.problem }) })); }
    catch (error) { next(error); }
  });
  router.post('/ops/pricing', guard, may('service.manage'), dev, sameOrigin, async (req,res) => {
    try {
      const policy = updatedPolicy(await checkout.policy(), req.body || {}, req.opsUser.id);
      await checkout.data(db.from('dev_pricing_policies').insert({ policy, effective_at: new Date().toISOString() }));
      res.redirect(303, '/ops/pricing?notice=' + encodeURIComponent('Saved. New quotes will use these settings.'));
    } catch (error) { res.redirect(303, '/ops/pricing?problem=' + encodeURIComponent(error.message)); }
  });
}

module.exports = { registerAdmin, settingsBody, updatedPolicy };
