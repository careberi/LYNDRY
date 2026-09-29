'use strict';
const {escapeHtml:e}=require('./layout');
function label(plan) {
  if(!plan)return 'Awaiting dispatch';
  if(plan.state==='CANCELED'&&!plan.shipday_order_id)return 'Awaiting dispatch';
  if(plan.simulation)return 'Simulated dispatch';
  return {PLANNED:'Preparing scheduled pickup',PROCESSING:'Requesting courier',BLOCKED:'Dispatch needs attention',REQUESTED:'Awaiting driver',ASSIGNED:'Driver assigned',REVIEW:'Dispatch needs review',COMPLETED:'Delivered to laundromat',CANCELED:'Courier canceled'}[plan.state]||'Status unavailable';
}
function summary(plan) {
  return '<strong>'+e(label(plan))+'</strong>'+(plan?.state==='ASSIGNED'&&plan.assigned_name?'<br>'+e(plan.assigned_name):'')+(plan?.problem?'<p role="status">'+e(plan.problem)+'</p>':'');
}
function card(plan,{order,drivers=[],canAssign=false,enabled=false,driverProblem=''}={}) {
  if(!plan&&!order)return '';
  const editable=canAssign&&enabled&&(!plan||(!plan.simulation&&plan.booking_dispatch&&(['PLANNED','BLOCKED','REQUESTED','ASSIGNED'].includes(plan.state)||(plan.state==='CANCELED'&&!plan.shipday_order_id))));
  const heading=label(plan);
  plan=plan||{};
  const controls=canAssign?'<h3>Assign through Shipday</h3>'+(driverProblem?'<p role="status">'+e(driverProblem)+'</p>':'')+
    '<form method="post" action="/ops/orders/'+e(order.order_number)+'/dispatch-pickup"><label>Driver<select name="driver" required><option value="THIRD_PARTY">Automatic third-party assignment (Uber / DoorDash)</option>'+drivers.map(d=>'<option value="'+e(d.id)+'" '+(plan.mode==='IN_HOUSE'&&String(plan.driver_id)===String(d.id)?'selected ':'')+(!d.isActive||!d.isOnShift?'disabled':'')+'>'+e(d.name)+(!d.isActive||!d.isOnShift?' — offline':'')+'</option>').join('')+'</select></label>'+
    (!plan.shipday_order_id?'<label>In-house arrival override (Eastern time, optional)<input type="datetime-local" name="arrival_local"></label><p>Leave blank to estimate travel time plus the loading buffer. For an in-house driver only; arrival must still fit laundromat hours and next-day collection.</p>':'')+
    (plan.assignment_requested_at||['REQUESTED','ASSIGNED'].includes(plan.state)?'<label><input type="checkbox" name="replace" value="yes" required> Replace the current driver/request. Cancellation charges may apply.</label>':'')+
    '<p>This requests a real driver through Shipday.</p><button type="submit" class="btn btn-primary" '+(editable?'':'disabled')+'>Assign</button></form>'+
    (!editable?'<p>'+(enabled?'This dispatch needs reconciliation before another driver can be requested.':'Live pickup assignment is unavailable in this environment.')+'</p>':''):'';
  return '<section class="card card-xl order-return-dispatch"><p class="eyebrow">Customer pickup</p><h2>'+e(heading)+'</h2>'+
    (plan.state==='ASSIGNED'&&plan.assigned_name?'<p>'+e(plan.assigned_name)+'</p>':'')+
    (plan.dispatch_at?'<p>Scheduled pickup: '+e(new Date(plan.dispatch_at).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}))+' Eastern</p>':'')+
    (plan.problem?'<p role="status">'+e(plan.problem)+'</p>':'')+
    controls+'</section>';
}
module.exports={label,summary,card};
