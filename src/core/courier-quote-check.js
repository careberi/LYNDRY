'use strict';
// Delivery quotes remain necessary, but no longer depend on customer spending caps.
async function beforeDispatch(order, { leg, courier, from, to, miles }) {
  try {
    const valid = q => q?.ok && Number.isSafeInteger(q.feeCents) && q.feeCents >= 0 && q.quoteId && Date.parse(q.expiresAt) > Date.now();
    const quote = await courier.quote({from, to, miles});
    if (!valid(quote)) return {ok:false, reason:'A current courier quote is required before dispatch.'};
    if (leg === 'TO_PARTNER') {
      const returning = await courier.quote({from:to, to:from, miles});
      if (!valid(returning)) return {ok:false, reason:'A current return-trip quote is required before pickup dispatch.'};
    }
    return {ok:true, quoteId:quote.quoteId};
  } catch (_) { return {ok:false, reason:'Courier estimates are unavailable. Try again before dispatch.'}; }
}
module.exports = {beforeDispatch};
