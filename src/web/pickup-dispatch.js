'use strict';
const {escapeHtml:e}=require('./layout');
const {canRetryUtcBoundaryReview}=require('../core/shipday-booking-dispatch');
const problemFor=plan=>canRetryUtcBoundaryReview(plan)?'The evening scheduling issue is fixed. Choose a driver to retry this pickup.':plan?.problem;
function label(plan,order) {
  if(!plan)return 'Awaiting dispatch';
  if(canRetryUtcBoundaryReview(plan))return 'Ready to retry pickup';
  if(plan.state==='CANCELED'&&!plan.shipday_order_id)return 'Awaiting dispatch';
  if(plan.simulation)return 'Simulated dispatch';
  if(require('../core/pickup-observation').progress(plan)) {
    if(plan.provider_status!=='ALREADY_DELIVERED')return 'Picked up · on the way to laundromat';
    // Courier delivery alone is not receipt; the order records the confirmed intake.
    if(order?.at_partner_at)return 'Received by laundromat';
    return order?'Delivered to laundromat · awaiting intake':'Delivered to laundromat';
  }
  if(plan.state==='ASSIGNED'&&plan.provider_status==='STARTED')return 'Driver on the way to pickup';
  return {PLANNED:'Preparing scheduled pickup',PROCESSING:'Requesting courier',BLOCKED:'Dispatch needs attention',REQUESTED:'Awaiting driver',ASSIGNED:'Driver assigned',REVIEW:'Dispatch needs review',COMPLETED:'Delivered to laundromat',CANCELED:'Courier canceled'}[plan.state]||'Status unavailable';
}
function summary(plan,order) {
  return '<strong>'+e(label(plan,order))+'</strong>'+(plan?.state==='ASSIGNED'&&plan.assigned_name?'<br>'+e(plan.assigned_name):'')+(problemFor(plan)?'<p role="status">'+e(problemFor(plan))+'</p>':'');
}
function card(plan,{order,drivers=[],canAssign=false,enabled=false,driverProblem='',eligibilityProblem=''}={}) {
  if(!plan&&!order)return '';
  const editable=!require('../core/pickup-observation').progress(plan)&&canAssign&&enabled&&!eligibilityProblem&&(!plan||(!plan.simulation&&plan.booking_dispatch&&(['PLANNED','BLOCKED','REQUESTED','ASSIGNED'].includes(plan.state)||(plan.state==='CANCELED'&&!plan.shipday_order_id)||canRetryUtcBoundaryReview(plan))));
  const heading=label(plan,order);
  plan=plan||{};
  const controls=canAssign?'<div class="pickup-assignment"><h3>Assign through Shipday</h3>'+(driverProblem?'<p role="status">'+e(driverProblem)+'</p>':'')+
    '<form method="post" action="/ops/orders/'+e(order.order_number)+'/dispatch-pickup"><label>Driver<select name="driver" required><option value="">Choose a driver</option><option value="THIRD_PARTY"'+(plan.state==='ASSIGNED'&&plan.mode==='THIRD_PARTY'?' selected':'')+'>Automatic third-party assignment (Uber / DoorDash)</option>'+drivers.map(d=>'<option value="'+e(d.id)+'" '+(plan.state==='ASSIGNED'&&plan.mode==='IN_HOUSE'&&String(plan.driver_id)===String(d.id)?'selected ':'')+(!d.isActive||!d.isOnShift?'disabled':'')+'>'+e(d.name)+(!d.isActive||!d.isOnShift?' — offline':'')+'</option>').join('')+'</select></label>'+
    (!plan.shipday_order_id?'<label>In-house arrival override (Eastern time, optional)<input type="datetime-local" name="arrival_local"></label><p>Leave blank to estimate travel time plus the loading buffer. For an in-house driver only; arrival must still fit laundromat hours and next-day collection.</p>':'')+
    (plan.assignment_requested_at||['REQUESTED','ASSIGNED'].includes(plan.state)?'<label><input type="checkbox" name="replace" value="yes" required> Replace the current driver/request. Cancellation charges may apply.</label>':'')+
    '<p>This requests a real driver through Shipday.</p><button type="submit" class="btn btn-primary" '+(editable?'':'disabled')+'>Assign</button></form>'+
    (!editable?'<p>'+(require('../core/pickup-observation').progress(plan)?'Pickup is already collected. Driver reassignment is unavailable.':eligibilityProblem|| (enabled?'This dispatch needs reconciliation before another driver can be requested.':'Live pickup assignment is unavailable in this environment.'))+'</p>':'')+'</div>':'';
  return '<section class="card card-xl order-return-dispatch pickup-dispatch-card"><div class="pickup-dispatch-status"><p class="eyebrow">Customer pickup</p><h2>'+e(heading)+'</h2>'+
    (plan.state==='ASSIGNED'&&plan.assigned_name?'<p>'+e(plan.assigned_name)+'</p>':'')+
    (plan.dispatch_at?'<p>Scheduled pickup: '+e(new Date(plan.dispatch_at).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}))+' Eastern</p>':'')+
    (problemFor(plan)?'<p role="status">'+e(problemFor(plan))+'</p>':'')+
    '</div>'+controls+'</section>';
}
function returnSummary(plan,order) {
  if(!plan&&order?.status!=='READY')return 'Not scheduled';
  if(!plan||plan.simulation||plan.state==='PLANNED')return '<strong role="status">Return driver needed</strong>'+(order?'<br><a href="/ops/orders/'+e(order.order_number)+'">Choose return driver</a>':'');
  const name=({PROCESSING:'Requesting courier',BLOCKED:'Needs attention',REQUESTED:'Awaiting driver',ASSIGNED:'Driver assigned',REVIEW:'Needs review',COMPLETED:'Delivery complete',CANCELED:'Canceled'})[plan.state]||'Status unavailable';
  return '<strong>'+e(name)+'</strong>'+(plan.assigned_name?'<br>'+e(plan.assigned_name):'')+(plan.problem?'<p role="status">'+e(plan.problem)+'</p>':'')+(['BLOCKED','REVIEW'].includes(plan.state)&&order?'<a href="/ops/orders/'+e(order.order_number)+'">Review return request</a>':'');
}
module.exports={label,summary,card,returnSummary};
