 'use strict';
// Resolve only explicit return-weight issue lines, not arbitrary customer issues.
function orderNumbers(issue) {
 return [...new Set([...String(issue?.reason||'').matchAll(/(?:^|\n)Order #(\d+): return weight mismatch\. Review the laundromat return hold\./g)].map(m=>Number(m[1])))];
}
function createResolver({loadOrders,readIntake,release,ready,closeIssue,requestReturn}) {
 return async function resolve(issue,admin,note) {
  const numbers=orderNumbers(issue);
  if(!numbers.length)return {handled:false};
  if(admin?.role!=='ADMIN'||admin.isMachine)throw Error('An administrator must release this weight hold.');
  const orders=await loadOrders(issue.customer_id,numbers);
  if(orders.length!==numbers.length)throw Error('Cannot identify every order linked to this weight issue.');
  const reason=String(note||issue.resolution||'Weight discrepancy reviewed and approved by administrator.').trim();
  if(reason.length<5)throw Error('Add at least five characters describing the weight review.');
  const pending=[];
  for(const order of orders) {
   if(['OUT_FOR_DELIVERY','DELIVERED','CANCELED'].includes(order.status))continue;
   const intake=await readIntake(order.id);
   if(!intake||intake.partner_id!==order.partner_id)throw Error('The laundromat assignment changed. Review the order.');
   if(intake.return_check_status==='HELD') {
    const result=await release(order.id,admin.id,reason);
    if(!result?.ok) {
     const current=await readIntake(order.id);
     if(current?.return_check_status!=='RELEASED')throw Error('Weight hold could not be released.');
    }
   } else if(!['PASSED','RELEASED'].includes(intake.return_check_status))throw Error('Return weight must be reviewed before this issue can be resolved.');
   const result=await ready(order,admin);
   if(!result?.ok)throw Error('Return readiness could not be saved: '+(result?.reason||'Review the order.'));
   pending.push(order);
  }
  await closeIssue(issue.id,admin,reason);
  const results=[];
  for(const order of pending) {
   let result;
   try {result=await requestReturn(order.id,order.partner_id,admin.name);}catch {result={ok:false,reason:'Return request failed. Retry from this issue.'};}
   results.push({number:order.order_number,...result});
  }
  return {handled:true,results};
 };
}
module.exports={orderNumbers,createResolver};
