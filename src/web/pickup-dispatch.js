'use strict';
const {escapeHtml:e}=require('./layout');
function label(plan) {
  if(!plan)return 'Awaiting dispatch';
  if(plan.simulation)return 'Simulated dispatch';
  return {PLANNED:'Preparing scheduled pickup',PROCESSING:'Requesting courier',BLOCKED:'Dispatch needs attention',REQUESTED:'Awaiting driver',ASSIGNED:'Driver assigned',REVIEW:'Dispatch needs review',COMPLETED:'Delivered to laundromat',CANCELED:'Courier canceled'}[plan.state]||'Status unavailable';
}
function summary(plan) {
  return '<strong>'+e(label(plan))+'</strong>'+(plan?.state==='ASSIGNED'&&plan.assigned_name?'<br>'+e(plan.assigned_name):'')+(plan?.problem?'<p role="status">'+e(plan.problem)+'</p>':'');
}
function card(plan) {
  if(!plan)return '';
  return '<section class="card card-xl order-return-dispatch"><p class="eyebrow">Customer pickup</p><h2>'+e(label(plan))+'</h2>'+
    (plan.state==='ASSIGNED'&&plan.assigned_name?'<p>'+e(plan.assigned_name)+'</p>':'')+
    '<p>Scheduled pickup: '+e(new Date(plan.dispatch_at).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}))+' Eastern</p>'+
    (plan.problem?'<p role="status">'+e(plan.problem)+'</p>':'')+
    '<p><a href="/ops/shipday/assignments">View Shipday assignment</a></p></section>';
}
module.exports={label,summary,card};
