'use strict';
const db=require('../db'),{config}=require('../config');
const {escapeHtml:e}=require('../web/layout');
const {sameOrigin}=require('./spending-routes');
const data=async q=>{const {data,error}=await q;if(error)throw error;return data;};
function tolerance(value) {
 const s=String(value??'').trim();
 if(!s)return null;
 if(!/^\d+(?:\.\d{1,2})?$/.test(s)||Number(s)>10)throw Error('Enter a difference from 0 to 10 lb, with at most two decimal places.');
 return Number(s);
}
function body(policy,held,notice='') {
 return '<h1>Laundromat return checks</h1>'+(notice?'<p role="status">'+e(notice)+'</p>':'')+
 '<p class="ops-note">Return weighing check: <strong>'+ (policy?.weight_tolerance_lb==null?'Inactive':'Enabled · ±'+e(policy.weight_tolerance_lb)+' lb')+'</strong></p>'+
 '<section class="card card-xl"><h2>Allowed weight difference</h2><p>With a 1 lb allowance, a 30 lb intake can return at 29–31 lb. Anything outside the saved allowance is held for review.</p><p>The absolute difference between intake and return weight. Zero requires an exact match. Saving a number enables the check. Leave blank to keep it inactive; existing holds still require review.</p>'+
 '<form method="post" action="/ops/laundry-checks"><label>Maximum difference (lb)<input name="tolerance_lb" type="number" min="0" max="10" step="0.01" value="'+e(policy?.weight_tolerance_lb??'')+'"></label><input type="hidden" name="version" value="'+e(policy?.updated_at||'')+'"><button class="btn btn-primary">Save return check</button></form></section>'+
 '<section class="card card-xl"><h2>Orders held for review</h2>'+ (held.length?held.map(i=>'<article><h3><a href="/ops/orders/'+e(i.orders.order_number)+'">Order #'+e(i.orders.order_number)+'</a></h3><p>Intake: '+e(i.weight_lb)+' lb · Return: '+e(i.return_weight_lb)+' lb · Allowed difference: '+e(i.return_tolerance_lb)+' lb</p><form method="post" action="/ops/laundry-checks/'+e(i.order_id)+'/release"><label>What was checked and why may this order leave?<textarea name="note" minlength="5" maxlength="1000" required></textarea></label><button class="btn btn-primary">Release weight hold</button></form></article>').join(''):'<p>No return weight holds.</p>')+'</section>';
}
function registerAdmin(router,{guard,may,adminPage}) {
 const dev=(req,res,next)=>config.supabase.isDevelopment?next():res.sendStatus(404);
 router.get('/ops/laundry-checks',guard,may('service.manage'),dev,async(req,res,next)=>{
  try {
   const [policy,held]=await Promise.all([
    data(db.from('laundromat_workflow_settings').select('*').eq('id',true).single()),
    data(db.from('partner_order_intakes').select('order_id,weight_lb,return_weight_lb,return_tolerance_lb,orders!inner(order_number)').eq('return_check_status','HELD').order('return_checked_at'))
   ]);
   res.type('html').send(adminPage({title:'Laundromat return checks',active:'/ops/admin',terminal:true,user:req.opsUser,
    body:body(policy,held,typeof req.query.notice==='string'?req.query.notice.slice(0,200):'')}));
  }catch(error){next(error);}
 });
 router.post('/ops/laundry-checks',guard,may('service.manage'),dev,sameOrigin,async(req,res)=>{
  let notice;
  try {
   const value=tolerance(req.body.tolerance_lb);
   const saved=await data(db.from('laundromat_workflow_settings').update({weight_tolerance_lb:value,updated_at:new Date().toISOString(),updated_by:req.opsUser.id})
    .eq('id',true).eq('updated_at',req.body.version).select('id').maybeSingle());
   notice=saved?'Return check saved. Existing holds still require review.':'Settings changed. Refresh before saving again.';
  }catch(error){notice=error.message;}
  res.redirect(303,'/ops/laundry-checks?notice='+encodeURIComponent(notice));
 });
 router.post('/ops/laundry-checks/:id/release',guard,may('service.manage'),dev,sameOrigin,async(req,res,next)=>{
  try {
   const result=await data(db.rpc('release_partner_return_weight',{p_order:req.params.id,p_admin:req.opsUser.id,p_note:req.body.note}));
   res.redirect(303,'/ops/laundry-checks?notice='+encodeURIComponent(result?.ok?'Weight hold released. The laundromat can request return collection.':'Hold was not released. Check the order and review note.'));
  }catch(error){next(error);}
 });
}
module.exports={registerAdmin,tolerance,body};
