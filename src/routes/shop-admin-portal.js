'use strict';
const express = require('express');
const roles = require('../core/roles');
const crypto = require('node:crypto');
const page = require('../web/shop-page');
const { createRouter: intakeRouter, token } = require('./shop-intake-routes');

// Keep the ops session on its own host. Each URL names its shop, so two open
// tabs cannot silently change which laundromat a form acts on.
function rewritePortalHtml(html, base) {
  return html.replace(/\b(href|action|src)="(\/shop(?=[/?#"])[^"]*)"/g, (all, attr, url) => {
    if (url === '/shop/app.webmanifest') return all;
    return `${attr}="${base + url.slice(5)}"`;
  });
}
function createRouter({ service, loadPartner, staffService = require('../core/partner-staff') }) {
  const router=express.Router({mergeParams:true});
  router.use(async(req,res,next)=>{
    try {
      if (!req.opsUser || req.opsUser.status !== 'ACTIVE' || req.opsUser.isMachine || !roles.can(req.opsUser,'partners.portal')) return res.sendStatus(403);
      const id=req.params.partnerId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'')) return res.sendStatus(404);
      const partner=await loadPartner(id);
      if(!partner || partner.type!=='LAUNDROMAT')return res.sendStatus(404);
      req.partner=partner;
      req.partnerUser={...req.opsUser,name:req.opsUser.name+' (LYNDRY admin)',isOpsAdmin:true};
      req.portalAdmin={name:req.opsUser.name,partnerId:partner.id};
      const base='/ops/partners/'+partner.id+'/portal';
      const send=res.send.bind(res),location=res.location.bind(res);
      res.send=body=>send(typeof body==='string'?rewritePortalHtml(body,base):body);
      res.location=url=>location(typeof url==='string'&&/^\/shop(?=[/?#]|$)/.test(url)?base+url.slice(5):url);
      req.url='/shop'+(req.url==='/'?'':req.url);
      next();
    } catch(error){next(error);}
  });
  const langOf = req => (req.body?.lang || req.query.lang) === 'es' ? 'es' : 'en';
  function csrf(req,res,next) {
    const supplied=req.body?.csrf, expected=token(req.partnerUser);
    if(typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) return res.status(403).send('Refresh this page and try again.');
    next();
  }
  router.get('/shop/staff',async(req,res,next)=>{
    try {
      const html=page.staffPage({lang:langOf(req),shop:req.partner,me:req.partnerUser,
        staff:await staffService.list(req.partner.id),
        flash:({added:'staffAdded',removed:'staffRemoved',restored:'staffRestored'})[req.query.done] || ({taken:'staffTaken',phone:'staffBadPhone',notyours:'staffNotYours'})[req.query.problem] || null});
      res.type('html').send(html.replace(/(<form\b[^>]*method="post"[^>]*>)/g,
        '$1<input type="hidden" name="csrf" value="'+token(req.partnerUser)+'">'));
    }catch(error){next(error);}
  });
  router.post('/shop/staff',csrf,async(req,res,next)=>{
    try {
      const result=await staffService.addAttendant({partnerId:req.partner.id,name:req.body.name,phone:req.body.phone});
      res.redirect(303,'/shop/staff?lang='+langOf(req)+(result.ok?'&done=added':'&problem='+(result.reason==='taken'?'taken':'phone')));
    }catch(error){next(error);}
  });
  router.post('/shop/staff/:id',csrf,async(req,res,next)=>{
    try {
      const status=req.body.status==='ACTIVE'?'ACTIVE':'DISABLED';
      const result=await staffService.setStatus(req.params.id,status,{partnerId:req.partner.id,notSelfId:req.partnerUser.id});
      res.redirect(303,'/shop/staff?lang='+langOf(req)+(result.ok?'&done='+(status==='ACTIVE'?'restored':'removed'):'&problem=notyours'));
    }catch(error){next(error);}
  });
  router.post('/shop/logout',(req,res)=>{
    require('../core/admin-auth').clearSessionCookie(res);
    const {config}=require('../config');
    const path=req.partner.slug?'/shop/'+encodeURIComponent(req.partner.slug):'/shop/login';
    res.redirect(303,config.baseUrl+path);
  });

  router.use(intakeRouter(service));
  return router;
}
module.exports={createRouter,rewritePortalHtml};
