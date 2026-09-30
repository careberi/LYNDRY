'use strict';
const express = require('express');
const crypto = require('node:crypto');
const view = require('../web/shop-intake-page');
const { validNumber } = require('../core/partner-intake');

function token(user) {
  return crypto.createHmac('sha256', user.session_token).update('laundromat-intake:' + user.id).digest('hex');
}
function createRouter(service) {
  const router = express.Router();
  function context(req) {
    return { shop: req.partner, isOwner: req.partnerUser.role === 'OWNER' || Boolean(req.portalAdmin), portalAdmin: req.portalAdmin,
      notice: req.query.notice,
      lang: (req.query.lang || req.body?.lang) === 'es' ? 'es' : 'en', csrf: token(req.partnerUser),
      query: typeof req.query.q === 'string' ? req.query.q.trim().slice(0,64) : '',
      stage: ['INCOMING','WASH','READY'].includes(req.query.stage) ? req.query.stage : '' };
  }
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/shop', async (req, res, next) => {
    try {
      const [orders,history]=await Promise.all([service.list(req.partner.id),service.history ? service.history(req.partner.id,req.query.history_page) : null]);
      res.type('html').send(view.board({ ...context(req),orders,history }));
    }
    catch (error) { next(error); }
  });
  router.get('/shop/orders/:number/delivery-photos/:index', async (req,res) => {
    res.set({'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    if (!validNumber(req.params.number)) return res.sendStatus(404);
    try {
      const photo=await service.deliveryPhoto(req.partner.id,req.params.number,req.params.index);
      if (!photo) return res.sendStatus(404);
      res.set('Content-Disposition','inline');
      return res.type(photo.contentType).send(photo.bytes);
    } catch { return res.status(502).send('Delivery photo unavailable. Refresh to try again.'); }
  });
  router.get('/shop/orders/:number', async (req, res, next) => {
    try {
      const order = await service.detail(req.partner.id, req.params.number);
      if (!order) return res.status(404).type('html').send(view.missing(context(req)));
      return res.type('html').send(view.detail({ ...context(req), order, notice: req.query.notice }));
    } catch (error) { next(error); }
  });
  router.post('/shop/orders/:number/:action', async (req, res, next) => {
    // All actions share session scope and CSRF; collection also rechecks Shipday.
    const ctx = context(req);
    const supplied = req.body?.csrf;
    if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) ||
        !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(ctx.csrf))) return res.status(403).send('Refresh this page and try again.');
    if (!validNumber(req.params.number)) return res.sendStatus(404);
    try {
      const result = await service.act({ partner: req.partner.id, staff: req.partnerUser,
        number: req.params.number, action: req.params.action,
        weight: req.body.weight_lb, shopReference: req.body.shop_reference ?? '' });
      if (!result.ok) {
        const order = await service.detail(req.partner.id, req.params.number);
        if (!order) return res.status(404).type('html').send(view.missing(ctx));
        return res.status(400).type('html').send(view.detail({ ...ctx, order, notice: result.reason,
          draft: { weight: req.body.weight_lb, shopReference:req.body.shop_reference } }));
      }
      if(result.notice==='collected')return res.redirect(303, `/shop?lang=${ctx.lang}&notice=collected`);
      return res.redirect(303, `/shop/orders/${req.params.number}?lang=${ctx.lang}&notice=${result.notice}`);
    } catch (error) { next(error); }
  });
  router.post('/shop/expected/:number/arrived', (req, res) => res.redirect(303, '/shop'));
  return router;
}
module.exports = { createRouter, token };
