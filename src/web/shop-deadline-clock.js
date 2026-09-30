'use strict';
const {countdown}=require('../core/laundromat-countdown');
function clock(calculate) {
 function update() {
  for(const el of document.querySelectorAll('[data-shop-deadline]')) {
   const result=calculate(el.dataset.shopDeadline,Date.now(),el.dataset.lang);
   el.textContent=result.text;
   el.className='shop-turnaround shop-turnaround--'+result.tone;
  }
 }
 update();
 const timer=setInterval(update,30000);
 window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
module.exports={clock,script:'<script>('+clock.toString()+')('+countdown.toString()+');</script>'};
