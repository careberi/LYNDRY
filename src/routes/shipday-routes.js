'use strict';
const { config } = require('../config');
const { createClient } = require('../providers/couriers/shipday');
const { sameOrigin } = require('./spending-routes');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function body({ configured, services = null, checkedAt = null, problem = null, quote = null, from = '', to = '', activeProvider = '' }) {
  return `<p><a href="/ops/couriers">← Couriers</a> · <a href="/ops/shipday/assignments">Driver assignments</a></p>
    <p class="eyebrow">Integration</p><h1>Shipday</h1>
    <div class="ops-note ops-note--warn"><strong>Live dispatch disabled.</strong> Connection and quote checks do not create orders or request drivers. Current booking provider: ${esc(activeProvider)}.</div>
    ${problem ? `<div class="ops-note ops-note--bad" role="alert">${esc(problem)}</div>` : ''}
    <section class="card card-xl ops-form-stack"><h2>Connection</h2>
    <p>API key: <strong>${configured ? 'Configured' : 'Not configured'}</strong></p>
    <p>${checkedAt ? `Last successful check: ${esc(checkedAt)}` : 'Connection has not been checked in this server session.'}</p>
    <form method="post" action="/ops/shipday/check"><button class="btn btn-ink" ${configured ? '' : 'disabled'}>Test connection and refresh services</button></form>
    ${services ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Courier service</th><th>Account access</th><th>Shipday environment</th></tr></thead><tbody>${services.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.status === true ? 'Enabled' : 'Disabled'}</td><td>${s.prod === true ? 'Live' : 'Test'}</td></tr>`).join('')}</tbody></table></div><p class="field-hint">Account access is managed in Shipday. Live service availability does not enable dispatch in LYNDRY.</p>` : ''}
    </section>
    <section class="card card-xl ops-form-stack"><h2>Check a delivery estimate</h2>
    <p>Check one trip between two addresses. For a round trip, check each direction separately.</p>
    <form method="post" action="/ops/shipday/quote" class="ops-form-stack">
    <label>Pickup address<input name="from" type="text" required maxlength="500" value="${esc(from)}" autocomplete="off"></label>
    <label>Delivery address<input name="to" type="text" required maxlength="500" value="${esc(to)}" autocomplete="off"></label>
    <p class="field-hint">These addresses will be sent to Shipday for an estimate.</p>
    <button class="btn btn-ink" ${configured ? '' : 'disabled'}>Get estimate</button></form>
    ${quote ? quote.ok ? `<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Service</th><th>Estimated courier fee</th></tr></thead><tbody>${quote.options.map((s) => `<tr><td>${esc(s.service)}</td><td>$${(s.feeCents / 100).toFixed(2)}</td></tr>`).join('')}</tbody></table></div><p class="field-hint">Courier estimates only. Additional Shipday charges are not yet verified. Do not use this as a final customer quote. Prices are checked again before assignment.</p>` : '<p role="status">No confirmed estimate is available for this trip.</p>' : ''}
    </section>
    <section class="card card-xl ops-form-stack"><h2>Dispatch</h2><p>Eligible scheduled pickups can be sent to Shipday automatically after booking and payment checks. View the assignment page for activation status, confirmed drivers and any problems.</p><a href="/ops/shipday/assignments">View driver assignments</a></section>`;
}

function registerAdmin(router, { guard, may, adminPage, client = createClient({ apiKey: config.shipday.apiKey, allowWrites: false }), configured = Boolean(config.shipday.apiKey), activeProvider = require('../providers/couriers').name }) {
  let services = null, checkedAt = null;
  function render(req, res, extra = {}) {
    res.set('Cache-Control', 'no-store, private');
    return res.type('html').send(adminPage({ title: 'Shipday', active: '/ops/shipday', user: req.opsUser, terminal: true,
      body: body({ configured, services, checkedAt, activeProvider, ...extra }) }));
  }
  router.get('/ops/shipday', guard, may('service.manage'), (req, res) => render(req, res));
  router.post('/ops/shipday/check', guard, may('service.manage'), sameOrigin, async (req, res) => {
    try {
      if (!configured) throw new Error('missing');
      const response = await client.services();
      if (!Array.isArray(response) || response.some((row) => !row || typeof row.name !== 'string' || typeof row.status !== 'boolean' || typeof row.prod !== 'boolean')) throw new Error('shape');
      services = response.map(({ name, status, prod }) => ({ name, status, prod }));
      checkedAt = new Date().toISOString();
      return res.redirect(303, '/ops/shipday');
    } catch {
      services = null; checkedAt = null;
      return render(req, res, { problem: 'Connection check failed. Check the API key and Shipday account access, then try again.' });
    }
  });
  router.post('/ops/shipday/quote', guard, may('service.manage'), sameOrigin, async (req, res) => {
    const from = typeof req.body?.from === 'string' ? req.body.from.trim() : '';
    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    if (!from || !to || from.length > 500 || to.length > 500) return render(req, res, { problem: 'Enter both addresses, up to 500 characters each.', from, to });
    try {
      const quote = await client.quote({ from, to });
      return render(req, res, { quote, from, to });
    } catch { return render(req, res, { problem: 'Shipday could not provide an estimate. Check the connection and addresses, then try again.', from, to }); }
  });
}
module.exports = { registerAdmin, body };
