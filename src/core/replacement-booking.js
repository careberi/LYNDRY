'use strict';
// Snapshot the old blocked checkout before booking; never dismiss a newer one.
async function book(customer, wanted, deps = {}) {
 const intents=deps.intents || require('./booking-intents');
 const create=deps.create || require('./recurring').bookAndSchedule;
 const previous=await intents.openFor(customer.id);
 const result=await create(customer,wanted);
 if(result.ok && !result.needsCard && !result.holdRefused && previous?.blocked_reason) {
  try { await intents.completeReplacement(previous,result.order,customer.id); }
  catch(error) { (deps.onError || console.error)('Replacement checkout completion failed: '+error.message); }
 }
 return result;
}
module.exports={book};
