'use strict';
function sameOrigin(req, res, next) {
  if (req.get('origin') !== req.protocol + '://' + req.get('host')) return res.status(403).send('Open this form on LYNDRY and try again.');
  next();
}
function gone(req,res) { return res.status(410).send('Spending approvals have been retired. Return to your dashboard.'); }
function registerAdmin(router,{guard,may}) {
  router.get('/ops/spending',guard,may('service.manage'),(req,res)=>res.redirect(303,'/ops'));
  router.post('/ops/spending',guard,may('service.manage'),sameOrigin,gone);
}
function registerCustomer(router,{requireCustomer}) {
  router.get('/account/orders/:id/spending',requireCustomer,(req,res)=>res.redirect(303,'/account'));
  router.post('/account/orders/:id/spending',requireCustomer,sameOrigin,gone);
}
module.exports={registerAdmin,registerCustomer,sameOrigin};
