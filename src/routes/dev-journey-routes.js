'use strict';
const db=require('../db');
const checkout=require('../core/dev-checkout');
const journey=require('../core/dev-journey');
const {sameOrigin}=require('./spending-routes');
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const money=n=>'$'+(Number(n)/100).toFixed(2);
function registerAdmin(router,{guard,may,adminPage}){
 const dev=(req,res,next)=>checkout.enabled?next():res.sendStatus(404);
 router.get('/ops/dev-orders',guard,may('service.manage'),dev,async(req,res,next)=>{
  try{
   const [rows,policy]=await Promise.all([checkout.data(db.from('orders').select('*').not('dev_quote_id','is',null).order('created_at',{ascending:false}).limit(50)),checkout.policy()]);
   const steps={REQUESTED:[['dispatch','Simulate selected dispatch time'],['collect','Simulate customer pickup']],IN_PROCESS:[['arrive','Simulate laundromat arrival']],AT_PARTNER:[['weigh','Record weight'],['pay','Settle test payment'],['ready','Mark ready']],READY:[['dispatch','Simulate return assignment'],['return','Simulate return collection']],OUT_FOR_DELIVERY:[['deliver','Simulate delivery']]};
   const body=`<h1>Development orders</h1><p class="ops-note ops-note--warn">Courier estimates and delivery events are simulated. Payments use Stripe test mode. No real drivers or live charges.</p><p><a href="/ops/shipday/assignments">Driver assignments</a> · <a href="/account/book">Book a test order</a></p>${req.query.notice?`<p role="status">${e(req.query.notice)}</p>`:''}
   <section class="card card-xl"><h2>Scheduled test pricing policy</h2><p>For immediate pricing changes, use <a href="/ops/pricing">Pricing and card holds</a>. This tool schedules a future policy in the development environment.</p><p>These are not net profit margins. Existing accepted quotes retain their saved policy.</p><form method="post" action="/ops/dev-orders/policy" class="ops-form-stack">${['ONE_TIME','SUBSCRIPTION','WHOLESALE'].map(k=>`<label>${e(k.replace('_',' '))} (%)<input type="number" name="${k}" step="0.01" min="0" max="95" value="${policy.marginBps[k]/100}" required></label>`).join('')}<label>Effective from (UTC)<input type="datetime-local" name="effective" required></label><button class="btn">Schedule pricing policy</button></form></section>
   ${rows.map(o=>{const s=o.pricing_snapshot,r=checkout.report(o);return `<section class="card card-xl"><h2>Order #${e(o.order_number)} · ${e(o.status)}</h2><p>${money(s.rateCentsPerLb)}/lb + ${money(s.operationalFeeCents)} operational fee · Inclusive minimum ${money(s.minimumTotalCents)} · Target ${s.targetMarginBps/100}%</p><p>Weight: ${e(o.weight_lb||'Not recorded')} lb · Payment: ${e(o.payment_status)} · Total: ${o.price_cents?money(o.price_cents):'Not weighed'}</p>
   ${(steps[o.status]||[]).map(([action,label])=>`<form method="post" action="/ops/dev-orders/${o.id}/action" class="ops-form-stack"><input type="hidden" name="action" value="${action}">${action==='weigh'?'<label>Actual weight (lb)<input name="weight" type="number" min="0.001" step="0.001" required></label>':''}<button class="btn">${label}</button></form>`).join('')}
   ${r?`<p>Development contribution: revenue ${money(r.revenueCents)} − washing ${money(r.washingCents)} − simulated courier ${money(r.courierCents)} − estimated processing ${money(r.processingCents)} = <strong>${money(r.contributionCents)} (${r.contributionPercent.toFixed(1)}%)</strong>. Other expenses excluded.</p>`:''}</section>`;}).join('')||'<p>No dynamic test orders yet.</p>'}`;
   res.type('html').send(adminPage({title:'Development orders',active:'/ops/shipday',terminal:true,user:req.opsUser,body}));
  }catch(err){next(err);}
 });
 router.post('/ops/dev-orders/policy',guard,may('service.manage'),dev,sameOrigin,async(req,res,next)=>{
  try{const current=await checkout.policy();const marginBps=Object.fromEntries(['ONE_TIME','SUBSCRIPTION','WHOLESALE'].map(k=>[k,Math.round(Number(req.body[k])*100)]));const updated={...current,marginBps};delete updated.version;for(const k of Object.keys(marginBps))require('../core/pricing-economics').validatePolicy(updated,k);const effective=new Date(req.body.effective+'Z');if(!Number.isFinite(effective.getTime()))throw Error('Choose a valid effective date.');await checkout.data(db.from('dev_pricing_policies').insert({policy:updated,effective_at:effective.toISOString()}));res.redirect(303,'/ops/dev-orders?notice=Pricing+policy+saved');}catch(err){res.status(400).send(e(err.message));}
 });
 router.post('/ops/dev-orders/:id/action',guard,may('orders.override'),dev,sameOrigin,async(req,res)=>{
  try{if(!/^[a-f0-9-]{36}$/i.test(req.params.id))throw Error('Invalid order.');const result=await journey.action(req.params.id,req.body.action,req.body,req.opsUser);res.redirect(303,'/ops/dev-orders?notice='+encodeURIComponent(result.notice));}catch(err){res.redirect(303,'/ops/dev-orders?notice='+encodeURIComponent(err.message));}
 });
}
module.exports={registerAdmin};
