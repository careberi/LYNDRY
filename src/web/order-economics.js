 'use strict';
const {escapeHtml:e}=require('./layout');
const economics=require('../core/pricing-economics');
const fees=require('./quote-fee-breakdown');
const cents=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const weight=v=>v!=null&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const money=v=>v==null?'Not available':(v<0?'−':'')+'$'+(Math.abs(v)/100).toFixed(2);
function calculate(order, paymentRows=[], courierRows=[]) {
 const s=order.pricing_snapshot||{}, policy=s.policy||{};
 const billed=weight(order.billable_weight_lb)??weight(order.weight_lb);
 const partnerWeight=weight(order.partner_bill_lb)??weight(order.weight_lb);
 const rate=cents(s.wholesaleCentsPerLb);
 const washing=partnerWeight!=null&&rate>0?economics.washingCostCents(partnerWeight,rate):null;
 const courier=['TO_PARTNER','TO_CUSTOMER'].map((leg,i)=>{
  const rows=(courierRows||[]).filter(r=>r.leg===leg&&r.delivery_id);
  const recorded=rows.length>0&&rows.every(r=>cents(r.fee_cents)!=null);
  return {value:recorded?rows.reduce((sum,r)=>sum+r.fee_cents,0):cents(i?s.returnCents:s.pickupCents),recorded};
 });
 const revenue=cents(order.price_cents);
 const ledger=paymentRows?.filter(r=>r.applies_to_wash!==false);
 const card=ledger?.filter(r=>r.method!=='CASH');
 const processingKnown=cents(policy.processingBps)!=null&&cents(policy.processingFixedCents)!=null;
 // Each recorded card transaction incurs its own fixed charge; cash does not.
 const processing=ledger?.length&&card.length===0?0:processingKnown&&revenue!=null
  ?(ledger?.length?card.reduce((n,r)=>n+Math.round(r.amount_cents*policy.processingBps/10000)+policy.processingFixedCents,0):require('../core/weight-based-pricing').isSnapshot(s)?require('../core/weight-based-pricing').processingCents(revenue,s):Math.round(revenue*policy.processingBps/10000)+policy.processingFixedCents):null;
 const other=require('../core/weight-based-pricing').isSnapshot(s)?(policy.otherCostCents||0)+(billed!=null?Math.ceil(billed*(policy.otherCostPerLbCents||0)):0):0;
 const totalCost=[washing,...courier.map(r=>r.value),processing].every(v=>v!=null)?washing+courier[0].value+courier[1].value+processing+other:null;
 const profit=revenue!=null&&totalCost!=null?revenue-totalCost:null;
 const laundry=require('../core/weight-based-pricing').isSnapshot(s)&&billed>0?economics.quotedTotal({...s,weightLb:billed}):billed!=null&&cents(s.rateCentsPerLb)>0?economics.washingCostCents(billed,s.rateCentsPerLb):null;
 return {billed,partnerWeight,washing,courier,processing,other,revenue,totalCost,profit,margin:revenue>0&&profit!=null?profit/revenue*100:null,laundry};
}
function render(order,paymentRows,courierRows) {
 const s=order.pricing_snapshot||{}, r=calculate(order,paymentRows,courierRows);
 const row=(name,value)=>'<div><dt>'+e(name)+'</dt><dd>'+e(money(value))+'</dd></div>';
 const feeRows=cents(s.operationalFeeCents)!=null?fees(s):[];
 const adjustment=r.revenue!=null&&r.laundry!=null&&(feeRows.length||require('../core/weight-based-pricing').isSnapshot(s))?r.revenue-r.laundry-s.operationalFeeCents:null;
 return '<div class="order-overview-grid order-economics"><section class="order-price-panel"><h3>Business costs</h3><dl>'+
 row('Laundromat · calculated'+(r.partnerWeight!=null?' on '+r.partnerWeight+' lb':''),r.washing)+
 r.courier.map((c,i)=>row((i?'Return delivery':'Pickup delivery')+(c.recorded?' · recorded':' · quote estimate'),c.value)).join('')+
 row('Payment processing · estimate',r.processing)+(r.other?row('Other saved cost allowances',r.other):'')+row('Total direct costs · estimate',r.totalCost)+
 '</dl><p class="hint">Laundry uses our saved laundromat cost per lb and settled partner weight when available, otherwise the recorded pickup weight. Courier estimates may differ from final invoices. Processing is estimated from the saved policy and recorded card payments, or assumes one card payment when no ledger is available.</p></section>'+
 '<section class="order-price-panel"><h3>Customer charges</h3><dl>'+row((require('../core/weight-based-pricing').isSnapshot(s)?'Inclusive laundry total':'Wash, dry & fold')+(r.billed!=null?' · '+r.billed+' lb':''),r.laundry)+feeRows.map(([k,v])=>row(k,v)).join('')+
 (adjustment?row('Minimum / discount / other adjustment',adjustment):'')+row(order.payment_status==='PAID'?'Total paid':'Order total · not confirmed paid',r.revenue)+
 '</dl><p class="hint">Uses the saved order price, not today’s rates. Fees are charged once per order.</p></section></div>'+
 '<section class="order-profit-summary"><h3>Estimated order profit</h3><dl>'+row('After direct costs',r.profit)+'<div><dt>Contribution margin</dt><dd>'+(r.margin==null?'Not available':r.margin.toFixed(1)+'%')+'</dd></div></dl><p class="hint">'+(order.payment_status!=='PAID'?'Projected only: payment is not confirmed. ':'')+'This is contribution before business overhead, not final net profit. Software, Google usage, insurance, labor outside these costs, refunds and other unrecorded expenses are not included. Missing costs remain unavailable.</p></section>';
}
module.exports={calculate,render};
