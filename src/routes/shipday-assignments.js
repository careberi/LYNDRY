'use strict';
const db=require('../db');
const runtime=require('../core/shipday-dispatch-runtime');
const {sameOrigin}=require('./spending-routes');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function returnDispatchCard({order,plan,drivers=[],simulation}){
  if(order.status!=='READY')return '';
  const active=drivers.filter(d=>d.isActive===true&&d.isOnShift===true);
  const problem=plan?.problem?`<p role="status">${esc(plan.problem)}</p>`:'';
  if(plan?.state==='ASSIGNED')return `<section class="card card-xl order-return-dispatch"><p class="eyebrow">Return delivery</p><h2>Driver assigned</h2><p><strong>${esc(plan.assigned_name||'Assigned in Shipday')}</strong> is scheduled to collect this order.</p><p><a href="/ops/shipday/assignments">View assignment</a></p></section>`;
  if(['PROCESSING','REVIEW'].includes(plan?.state))return `<section class="card card-xl order-return-dispatch"><p class="eyebrow">Return delivery</p><h2>Dispatch needs review</h2>${problem}<p><a href="/ops/shipday/assignments">Open Shipday assignments</a></p></section>`;
  if(!simulation)return `<section class="card card-xl order-return-dispatch"><p class="eyebrow">Return delivery</p><h2>Live dispatch is disabled</h2><p>Enable live Shipday dispatch before requesting a driver.</p></section>`;
  return `<section class="card card-xl order-return-dispatch"><p class="eyebrow">Return delivery</p><h2>Dispatch a driver</h2><p>This order is ready and waiting at the laundromat. Choose who will collect and deliver it.</p>${problem}
    <div class="order-return-dispatch-actions">
      <form method="post" action="/ops/orders/${esc(order.order_number)}/dispatch-return"><input type="hidden" name="mode" value="THIRD_PARTY"><button class="btn btn-primary" type="submit">Dispatch third-party driver</button></form>
      <form method="post" action="/ops/orders/${esc(order.order_number)}/dispatch-return" class="order-return-inhouse"><input type="hidden" name="mode" value="IN_HOUSE"><label>In-house driver<select name="driver_id" required><option value="">Choose a driver</option>${active.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label><button class="btn" type="submit" ${active.length?'':'disabled'}>Dispatch in-house driver</button></form>
    </div><p class="field-hint">Development simulation: no real driver is requested.</p></section>`;
}
function registerReturnDispatch(router,{guard,may},service=runtime,database=db){
  router.post('/ops/orders/:id/dispatch-return',guard,may('orders.override'),sameOrigin,async(req,res)=>{
    const back='/ops/orders/'+encodeURIComponent(req.params.id);
    const fail=e=>res.redirect(303,back+'?problem='+encodeURIComponent(e.message||'Driver could not be dispatched.'));
    try{
      if(!/^\d+$/.test(String(req.params.id)))throw Error('Use an order number.');
      const order=await service.result(database.from('orders').select('*').eq('order_number',req.params.id).maybeSingle());
      if(!order)throw Error('Order not found.');
      if(order.status!=='READY')throw Error('Only laundry marked ready can be dispatched for return.');
      if(!['PAID','WAIVED'].includes(order.payment_status))throw Error('Settle payment before return delivery.');
      const mode=String(req.body?.mode||'');
      if(!['THIRD_PARTY','IN_HOUSE'].includes(mode))throw Error('Choose an in-house or third-party driver.');
      let driverId=null;
      if(mode==='IN_HOUSE'){
        driverId=String(req.body?.driver_id||'');
        const drivers=await service.provider.drivers();
        if(!drivers.some(d=>String(d.id)===driverId&&d.isActive===true&&d.isOnShift===true))throw Error('Choose an active in-house driver.');
      }
      const plans=await service.enroll(order,'TO_CUSTOMER');
      const plan=plans&&plans[0];
      if(!plan)throw Error('The return assignment could not be prepared.');
      if(plan.state==='ASSIGNED')throw Error('A driver is already assigned. Open Shipday assignments to replace them safely.');
      if(['PROCESSING','REVIEW'].includes(plan.state))throw Error('This assignment needs review in Shipday before another driver can be requested.');
      const result=await service.run(plan.id,{mode,driverId},`staff:${req.opsUser.id}`);
      if(!result.ok)throw Error(result.reason||'Shipday did not confirm the assignment.');
      return res.redirect(303,back+'?done='+encodeURIComponent(mode==='IN_HOUSE'?'In-house driver dispatched.':'Third-party driver dispatched.'));
    }catch(e){return fail(e);}
  });
}
function registerAdmin(router,{guard,may,adminPage}){
  registerReturnDispatch(router,{guard,may});
  registerPickupDispatch(router,{guard,may});
  router.post('/ops/orders/:id/details',guard,may('orders.override'),sameOrigin,async(req,res)=>{
    const back='/ops/orders/'+encodeURIComponent(req.params.id);
    try{
      if(!require('../config').config.supabase.isDevelopment)throw Error('Order editing is available in development only.');
      if(!/^\d+$/.test(String(req.params.id)))throw Error('Use an order number.');
      const order=await runtime.result(db.from('orders').select('*,customers(*)').eq('order_number',req.params.id).single());
      await require('../core/order-details-edit').save(order,req.body,req.opsUser);
      res.redirect(303,back+'?done='+encodeURIComponent('Order details and pricing updated.'));
    }catch(error){res.redirect(303,back+'?problem='+encodeURIComponent(error.message));}
  });
  router.get('/ops/shipday/assignments',guard,may('orders.override'),async(req,res,next)=>{
    try{
      const [plans,drivers,settings]=await Promise.all([runtime.list(),runtime.provider.drivers(),runtime.settings()]);
      res.set('Cache-Control','no-store, private');
      res.type('html').send(adminPage({title:'Driver assignments',active:'/ops/shipday',terminal:true,user:req.opsUser,body:`
      <p><a href="/ops/shipday">← Shipday</a></p><h1>Driver assignments</h1><p><a href="/ops/dev-orders">Complete a development order</a></p>
      <div class="ops-note ops-note--warn">${settings.automatic_pickups_from?'Automatic pickup bookings request real Uber/DoorDash couriers through Shipday. Older simulated plans remain labeled below.':runtime.simulation?'Development simulation. No real drivers are requested or reassigned.':'Live dispatch is disabled pending activation.'}</div>
      ${req.query.problem?`<div class="ops-note ops-note--bad">${esc(req.query.problem)}</div>`:''}
      <section class="card card-xl ops-form-stack"><h2>Automatic dispatch</h2><p>Eligible new pickups are sent to Shipday after booking and payment checks, scheduled for the selected pickup time. Awaiting driver means the courier request is accepted but no driver is confirmed. Return collection follows the laundromat readiness workflow.</p>
      <p>Scheduler: ${settings.enabled?'On':'Paused'}. New orders from ${esc(settings.starts_at)} are enrolled automatically.</p>
      <form method="post" action="/ops/shipday/assignments/scheduler"><input type="hidden" name="enabled" value="${settings.enabled?'no':'yes'}"><button class="btn">${settings.enabled?'Pause':'Resume'} automatic dispatch</button></form>
      <form method="post" action="/ops/shipday/assignments/enroll" class="ops-form-stack"><label>Existing LYNDRY order number<input name="order" inputmode="numeric" pattern="[0-9]+" required></label><label>Trip<select name="leg"><option value="TO_PARTNER">Customer pickup</option><option value="TO_CUSTOMER">Return delivery</option></select></label><button class="btn">Add order to dispatch</button></form></section>
      ${plans.map(p=>`<section class="card card-xl ops-form-stack"><h2><a href="/ops/orders/${esc(p.orders?.order_number)}">#${esc(p.orders?.order_number)}</a> · ${p.leg==='TO_PARTNER'?'Pickup':'Return'}</h2><p>Dispatch: ${esc(new Date(p.dispatch_at).toLocaleString('en-US',{timeZone:'America/New_York'}))} Eastern · ${esc(p.state)}</p><p>${p.mode==='IN_HOUSE'?'In-house':'Third-party'} · ${esc(p.assigned_name||'Not assigned')}</p>${p.problem?`<p role="status">${esc(p.problem)}</p>`:''}
      ${p.booking_dispatch?'<p>'+require('../web/pickup-dispatch').summary(p)+'</p><p>Automatic retries apply only to confirmed failures. Reconcile uncertain requests in Shipday; never create a replacement blindly.</p>':['PLANNED','BLOCKED','ASSIGNED'].includes(p.state)?`<form method="post" action="/ops/shipday/assignments/${esc(p.id)}/change" class="ops-form-stack"><label>Assignment<select name="driver"><option value="THIRD_PARTY" ${p.mode==='THIRD_PARTY'?'selected':''}>Automatic third-party courier</option>${drivers.map(d=>`<option value="${esc(d.id)}" ${p.mode==='IN_HOUSE'&&String(p.driver_id)===String(d.id)?'selected':''} ${d.isActive&&d.isOnShift?'':'disabled'}>${esc(d.name)}${d.isActive&&d.isOnShift?'':' — offline'}</option>`).join('')}</select></label>${p.state==='ASSIGNED'?'<label><input type="checkbox" name="fees" value="yes" required> I understand cancellation may incur a fee. The current courier must be released before reassignment.</label>':''}<button class="btn">${p.state==='ASSIGNED'?'Replace driver':'Save assignment'}</button></form>`:'<p>Dispatch review required. Do not retry an uncertain vendor assignment.</p>'}
      <details><summary>Assignment history</summary><ul>${(p.history||[]).map(h=>`<li>${esc(h.at)} · ${esc(h.event)} · ${esc(h.actor)}</li>`).join('')}</ul></details></section>`).join('')||'<p>No orders queued for dispatch.</p>'}`}));
    }catch(e){next(e);}
  });
  const fail=(res,e)=>res.redirect(303,'/ops/shipday/assignments?problem='+encodeURIComponent(e.message||'Assignment could not be changed.'));
  router.post('/ops/shipday/assignments/scheduler',guard,may('service.manage'),sameOrigin,async(req,res)=>{
    try{if(!['yes','no'].includes(req.body?.enabled))throw Error('Invalid setting.');await runtime.result(db.from('shipday_dispatch_settings').update({enabled:req.body.enabled==='yes'}).eq('id',true));res.redirect(303,'/ops/shipday/assignments');}catch(e){fail(res,e);}
  });
  router.post('/ops/shipday/assignments/enroll',guard,may('orders.override'),sameOrigin,async(req,res)=>{
    try{if(!/^\d+$/.test(req.body?.order||'')||!['TO_PARTNER','TO_CUSTOMER'].includes(req.body?.leg))throw Error('Choose an order and trip.');const order=await runtime.result(db.from('orders').select('*').eq('order_number',req.body.order).single());if(!['REQUESTED','READY'].includes(order.status))throw Error('This order is not awaiting dispatch.');await runtime.enroll(order,req.body.leg);res.redirect(303,'/ops/shipday/assignments');}catch(e){fail(res,e);}
  });
  router.post('/ops/shipday/assignments/:id/change',guard,may('orders.override'),sameOrigin,async(req,res)=>{
    try{if(!/^[a-f0-9-]{36}$/i.test(req.params.id))throw Error('Invalid assignment.');const driver=req.body?.driver;if(typeof driver!=='string'||driver.length>80)throw Error('Choose a driver.');const changed=await runtime.run(req.params.id,{mode:driver==='THIRD_PARTY'?'THIRD_PARTY':'IN_HOUSE',driverId:driver==='THIRD_PARTY'?null:driver,acceptCancellationFee:req.body.fees==='yes'},`staff:${req.opsUser.id}`);if(!changed.ok)throw Error(changed.reason);res.redirect(303,'/ops/shipday/assignments');}catch(e){fail(res,e);}
  });
}
function registerPickupDispatch(router,{guard,may},service=require('../core/shipday-booking-runtime'),database=db){
  router.post('/ops/orders/:id/dispatch-pickup',guard,may('orders.override'),sameOrigin,async(req,res)=>{
    const back='/ops/orders/'+encodeURIComponent(req.params.id);
    try{
      if(!service.enabled)throw Error('Live pickup assignment is unavailable in this environment.');
      if(!/^\d+$/.test(String(req.params.id)))throw Error('Use an order number.');
      const order=await runtime.result(database.from('orders').select('*').eq('order_number',req.params.id).single());
      if(order.status!=='REQUESTED')throw Error('Only a pickup awaiting collection can be assigned.');
      const driver=String(req.body?.driver||'');
      if(driver!=='THIRD_PARTY'&&!/^\d+$/.test(driver))throw Error('Choose a Shipday driver.');
      const arrivalLocal=String(req.body?.arrival_local||'');
      if(arrivalLocal&&driver==='THIRD_PARTY')throw Error('Manual arrival is only available for an in-house driver.');
      if(arrivalLocal)require('../core/pickup-timing').manualArrival(arrivalLocal,require('../core/shipday-dispatch').dispatchInstant(order.pickup_date,String(order.pickup_time||'').slice(0,5)));
      const plan=await service.enqueue(order,{manual:true});
      if(!plan)throw Error('This pickup is not eligible for Shipday dispatch.');
      const result=await service.run(plan.id,{mode:driver==='THIRD_PARTY'?'THIRD_PARTY':'IN_HOUSE',driverId:driver==='THIRD_PARTY'?null:driver,acceptCancellationFee:req.body?.replace==='yes',...(arrivalLocal?{arrivalLocal}:{})},'staff:'+req.opsUser.id);
      if(!result.ok)throw Error(result.reason||'Shipday assignment needs review.');
      res.redirect(303,back+'?done='+encodeURIComponent('Shipday assignment updated.'));
    }catch(error){res.redirect(303,back+'?problem='+encodeURIComponent(error.message));}
  });
}
module.exports={registerAdmin,registerReturnDispatch,returnDispatchCard,registerPickupDispatch};
