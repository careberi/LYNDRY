'use strict';
// Saved cost terms, not an estimated per-pound rate, determine the final bill.
const METHOD = 'WEIGHT_BASED_MARGIN_V1';
const CUSTOMER_BASE = 'CUSTOMER_BASE_V1';
// An explicit saved discriminator protects quotes created under the cost model.
function laundryPricingRate(s) {
  if (s.laundryPricingBasis == null) return s.wholesaleCentsPerLb;
  if (s.laundryPricingBasis !== CUSTOMER_BASE) throw new RangeError('Unknown laundry pricing basis');
  return integer(s.customerBaseCentsPerLb, 'customer pricing base', 1);
}
const isSnapshot = s => s?.pricingMethod === METHOD;
function integer(n, label, min=0, max=Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(n) || n<min || n>max) throw new RangeError('Invalid '+label);
  return n;
}
function estimatedWeight(value=30) {
  const n=Number(value);
  if (!Number.isFinite(n)||n<1||n>50||Math.round(n*1000)/1000!==n) throw new RangeError('Enter a bag weight from 1 to 50 lb, with up to three decimal places.');
  return n;
}
function validate(s) {
  const p=s.policy;
  integer(s.wholesaleCentsPerLb,'wholesale cost',1);
  laundryPricingRate(s);
  integer(s.pickupCents,'pickup cost'); integer(s.returnCents,'return cost');
  integer(s.minimumTotalCents,'minimum');
  if(s.minimumWeightLb != null) integer(s.minimumWeightLb,'minimum weight',1,50);
  integer(p.processingBps,'processing percentage',0,9999);
  integer(p.processingFixedCents,'processing fixed cost');
  integer(p.otherCostCents??0,'other order costs');
  integer(p.otherCostPerLbCents??0,'other cost per pound');
  const margin=integer(p.marginBps?.[s.category],'category target',0,9999);
  if(margin+p.processingBps>=10000) throw new RangeError('Margin and processing must total less than 100%.');
  if(p.cardHold) {
    if(!['FIXED','MINIMUM','MAXIMUM'].includes(p.cardHold.mode)) throw new RangeError('Invalid card hold mode');
    if(p.cardHold.mode==='FIXED') integer(p.cardHold.fixedCents,'card hold',1);
  }
  return 10000-margin-p.processingBps;
}
const ceilRatio=(n,d)=>Number((n+d-1n)/d);
const weightCost=(w,r)=>ceilRatio(BigInt(Math.round(w*1000))*BigInt(r),1000n);
function processingCents(total,s) {
  const p=s.policy;
  const charge=n=>Number((BigInt(n)*BigInt(p.processingBps)+5000n)/10000n)+p.processingFixedCents;
  const hold=p.cardHold?.mode==='FIXED'?p.cardHold.fixedCents:p.cardHold?.mode==='MINIMUM'?s.minimumTotalCents:total;
  // Reserve the two fixed charges for hold/balance settlement at every weight.
  // Below the hold this is conservative, and avoids a fee cliff at that boundary.
  return hold>0&&total>hold?charge(hold)+charge(total-hold):charge(total)+(['FIXED','MINIMUM'].includes(p.cardHold?.mode)?p.processingFixedCents:0);
}
function total(s,weightLb,{applyMinimum=true}={}) {
  const keep=validate(s);
  if(typeof weightLb!=='number'||!Number.isFinite(weightLb)||weightLb<=0||weightLb>50||Math.abs(Math.round(weightLb*1000)/1000-weightLb)>1e-9) throw new RangeError('Enter a valid order weight up to 50 lb.');
  const p=s.policy, margin=p.marginBps[s.category];
  const costs=weightCost(weightLb,laundryPricingRate(s))+s.pickupCents+s.returnCents+(p.otherCostCents??0)+weightCost(weightLb,p.otherCostPerLbCents??0);
  integer(costs,'total cost');
  let price=Math.max(applyMinimum?s.minimumTotalCents:0,ceilRatio(BigInt(costs+p.processingFixedCents)*10000n,BigInt(keep)));
  // Percentage fees round per transaction. Resolve both rounding and any second fixed fee.
  for(let i=0;i<10;i++) {
    integer(price,'total price',1);
    const shortfall=BigInt(price)*BigInt(margin)-BigInt(price-costs-processingCents(price,s))*10000n;
    if(shortfall<=0n) return price;
    price+=Math.max(1,ceilRatio(shortfall,BigInt(keep)));
  }
  throw new RangeError('Could not calculate a safe order total.');
}
// Display the minimum as a bundle. Round its allowance DOWN, so the quoted
// minimum actually buys the weight we advertise. Billing still uses total().
function minimumIncludedWeight(s, {totalAtWeight = w => total(s, w)} = {}) {
  if(s.minimumWeightLb != null) return integer(s.minimumWeightLb,'minimum weight',1,50);
  const minimum = s.minimumTotalCents;
  if (totalAtWeight(1) > minimum) return 0;
  let low = 100, high = 5000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (totalAtWeight(middle / 100) <= minimum) low = middle;
    else high = middle - 1;
  }
  return low / 100;
}
function summary(s) {
 const w=s.estimatedWeightLb||30, price=total(s,w);
 return `Estimated total $${(price/100).toFixed(2)} for ${w} lb, delivery and processing included. Final total recalculates at measured weight; $${(s.minimumTotalCents/100).toFixed(2)} minimum, up to 50 lb.`;
}
module.exports={METHOD,CUSTOMER_BASE,laundryPricingRate,isSnapshot,estimatedWeight,total,processingCents,validate,minimumIncludedWeight,summary};
