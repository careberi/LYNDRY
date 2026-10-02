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
  if(current.pricingMethod===require('../core/weight-based-pricing').METHOD) {
    for(const [key,field] of [['minimumTotalCents','minimum_total'],['otherCostCents','other_cost'],['otherCostPerLbCents','other_cost_per_lb']]) {
      if(form[field]==null) continue;
      const value=String(form[field]).trim();
      if(!/^\d+(?:\.\d{1,2})?$/.test(value)||Number(value)>10000) throw Error('Enter valid dollar amounts with up to two decimal places.');
      result[key]=Math.round(Number(value)*100);
    }
    if(current.minimumWeightLb!=null) {
      const value=String(form.minimum_weight_lb??current.minimumWeightLb).trim();
      if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>50) throw Error('Enter a minimum weight from 1 to 50 lb.');
      result.minimumWeightLb=Number(value);
      result.minimumTotalCents=0;
    } else if(result.minimumTotalCents<1) throw Error('The order minimum must be positive.');
  }
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
      <section class="card card-xl"><h2>Pricing margin by tier</h2>${policy.pricingMethod === 'COST_PLUS_MARGIN_15' ? '<p>The customer washing base includes the category margin and processing allowance. Combined transportation fees use transportation cost divided by one minus the category margin, rounded to the nearest cent. Processing costs are not added to that fee calculation. Operational fees allocate 25% of the adjusted total and service fees allocate $1.99; delivery receives the remainder. New orders have a $15 inclusive minimum. The reference weight is used for shop comparison and capacity, not to spread transportation into the laundry rate.</p>' : ''}
        <p>The formula applies these percentages to the selected pricing base, delivery and processing. Actual profit uses our laundromat cost and may differ from this target. Other business expenses are excluded.</p>
        ${economics.CATEGORIES.map(key => `<label>${e({ ONE_TIME: 'One-time pickup', SUBSCRIPTION: 'Subscription', WHOLESALE: 'Wholesale' }[key])} (%)<input name="${key}" type="number" min="0" max="99.99" step="0.01" value="${policy.marginBps[key] / 100}" required></label>`).join('')}
      </section>
      ${policy.pricingMethod===require('../core/weight-based-pricing').METHOD?`<section class="card card-xl"><h2>Inclusive weight pricing</h2><p>New prices use the customer pricing base per lb, pickup and return costs, processing and the allowances below. The customer's estimated weight selects the quote; measured weight determines the bill. The customer pricing base also drives laundromat comparisons. Our laundromat cost is kept separately for supplier payments and actual profit reporting. Blank customer bases use our laundromat cost. Processing includes the fixed charge for each expected hold or balance payment. Costs and policy are saved with each quote.</p>
      ${policy.minimumWeightLb!=null?`<label>Minimum billable weight (lb)<input name="minimum_weight_lb" type="number" min="1" max="50" step="1" value="${policy.minimumWeightLb}" required></label><p>Each tier and address has its own inclusive minimum price at this weight. Smaller bags pay that same total.</p>`:`<label>Minimum total ($)<input name="minimum_total" type="number" min="0.01" max="10000" step="0.01" value="${(policy.minimumTotalCents/100).toFixed(2)}" required></label>`}
      <label>Other cost allowance per order ($)<input name="other_cost" type="number" min="0" max="10000" step="0.01" value="${((policy.otherCostCents||0)/100).toFixed(2)}"></label>
      <label>Other cost allowance per pound ($)<input name="other_cost_per_lb" type="number" min="0" max="10000" step="0.01" value="${((policy.otherCostPerLbCents||0)/100).toFixed(2)}"></label><p>The target is applied to the pricing base. A base above or below our actual cost changes the actual margin. A minimum can raise the percentage on smaller bags. Unrecorded expenses and later courier price changes are not guaranteed.</p></section>`:''}
      <section class="card card-xl"><h2>Card authorization hold</h2>
        <p>A temporary hold, not an additional charge. The final bill still uses the actual laundry weight.</p>
        <label>Hold amount<select name="hold_mode">${[['FIXED','Fixed dollar amount'],['MINIMUM','Order minimum total'],['MAXIMUM','Order maximum total (50 lb)']].map(([value,label]) => `<option value="${value}"${hold.mode === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Fixed amount ($)<input name="hold_fixed" type="number" min="0.50" max="10000" step="0.01" value="${hold.fixedCents == null ? '' : (hold.fixedCents / 100).toFixed(2)}"></label>
        <p>Fixed amount is used only when selected. Minimum and maximum use each order’s saved price, including its quoted fees.</p>
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
