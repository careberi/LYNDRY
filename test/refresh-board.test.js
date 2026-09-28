'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {script}=require('../src/web/shop-board-refresh');
test('30-second refresh preserves outer inputs, replaces only the board, and fails closed on stale data',async()=>{
 let callback,period,calls=0,fail=false,hidden=false;
 const eta={textContent:'12 min'},link={setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},href:'/shop/orders/9015'};
 const board={innerHTML:'old',contains:()=>false,classList:{add(){hidden=true;},remove(){hidden=false;}},querySelectorAll:s=>s==='[data-live-eta]'?[eta]:[link]};
 const note={textContent:'Initial',dataset:{updated:'Updated',unavailable:'Unavailable',failed:'Refresh failed'}};
 const input={value:'unfinished search'};
 const document={getElementById:id=>id==='shop-board-live'?board:id==='shop-sync-note'?note:input,activeElement:input};
 const context={document,location:{href:'http://pos.localhost/partners/shop/portal'},window:{addEventListener(){}},AbortController,Date,
  setInterval(fn,ms){callback=fn;period=ms;},clearInterval(){},setTimeout(){},clearTimeout(){},
  DOMParser:class{parseFromString(){return {getElementById:()=>({innerHTML:'updated rows'})};}},
  fetch:async(url,options)=>{calls++;assert.equal(url,context.location.href);assert.equal(options.redirect,'error');if(fail)throw Error('offline');return {ok:true,text:async()=>'<div>rows</div>'};},
 };
 vm.runInNewContext(script.slice(8,-9),context);
 assert.equal(period,30000);await callback();assert.equal(board.innerHTML,'updated rows');assert.equal(input.value,'unfinished search');assert.match(note.textContent,/Updated/);
 fail=true;await callback();assert.equal(eta.textContent,'Unavailable');assert.equal(link.href,undefined);assert.equal(link['aria-disabled'],'true');assert.equal(hidden,true);assert.equal(note.textContent,'Refresh failed');
 fail=false;await callback();assert.equal(hidden,false);assert.equal(calls,3);
});
