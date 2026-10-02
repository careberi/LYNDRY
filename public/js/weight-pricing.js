'use strict';
document.querySelectorAll('[data-weight-pricing]').forEach(root=>{
 const input=root.querySelector('[name="estimated_weight_lb"]'),slider=root.querySelector('[data-weight-slider]');
 if(!input||!slider)return;
 const money=cents=>'$'+(cents/100).toFixed(2);
 const problem=root.querySelector('#weight-error');
 const adjust=Array.from(root.querySelectorAll('[data-weight-adjust]'));
 function announce(){const status=root.querySelector('[data-weight-status]');if(status&&valid())status.textContent=Array.from(root.querySelectorAll('[data-weight-tier]')).map(card=>(card.dataset.category==='SUBSCRIPTION'?'Subscription':card.dataset.category==='WHOLESALE'?'Wholesale':'One-time')+' estimate '+card.querySelector('[data-quote-total]').textContent).join('. ');}
 function valid(){
  const ok=input.validity.valid&&Number.isInteger(Number(input.value))&&Number(input.value)>=1&&Number(input.value)<=50;
  if(problem)problem.hidden=ok;
  input.setAttribute('aria-invalid',String(!ok));
  root.querySelectorAll('[data-weight-book]').forEach(a=>a.setAttribute('aria-disabled',String(!ok)));
  return ok;
 }
 root.querySelectorAll('[data-weight-book]').forEach(a=>a.addEventListener('click',event=>{if(!valid()){event.preventDefault();input.focus();}}));
 root.addEventListener('change',announce);
 adjust.forEach(button=>button.addEventListener('click',()=>{const weight=Math.max(1,Math.min(50,(Number(input.value)||Number(slider.value))+Number(button.dataset.weightAdjust)));input.value=slider.value=String(weight);valid();paint(weight);announce();}));
 function paint(weight){
  if(!Number.isInteger(weight)||weight<1||weight>50)return;
  root.querySelectorAll('[data-weight-tier]').forEach(card=>{
   const total=JSON.parse(card.dataset.weightTotals)[weight-1];
   const included=Number(card.dataset.minimumWeight),minimum=Number(card.dataset.minimumTotal);
   const atMinimum=included>0 && weight<=included;
   card.querySelector('[data-quote-rate]').textContent=money(atMinimum?minimum/included:total/weight);
   card.querySelector('[data-quote-rate-caption]').textContent=atMinimum
    ? 'Minimum-order rate · up to '+included+' lb' : 'Average price at '+weight+' lb';
   card.querySelector('[data-quote-total]').textContent=money(total);
   card.querySelectorAll('[data-selected-weight]').forEach(n=>n.textContent=String(weight));
   const link=card.querySelector('[data-weight-book]');
   if(link)link.href='/account/login?next='+encodeURIComponent('/account/book?estimated_weight_lb='+weight+'&plan='+card.dataset.category);
  });
  slider.setAttribute('aria-valuetext',weight+' pounds');
  slider.style.setProperty('--weight-progress',((weight-1)/49*100)+'%');
  adjust.forEach(button=>button.disabled=Number(button.dataset.weightAdjust)<0?weight<=1:weight>=50);
 }
 slider.addEventListener('input',()=>{input.value=slider.value;valid();paint(Number(slider.value));});
 input.addEventListener('input',()=>{if(valid()){slider.value=input.value;paint(Number(input.value));}});
 paint(Number(input.value));
});
