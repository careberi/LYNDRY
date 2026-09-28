'use strict';
// Only the board refreshes. Intake forms are on another page and are never replaced.
function refreshBoard() {
  const board = document.getElementById('shop-board-live');
  const note = document.getElementById('shop-sync-note');
  if (!board || !note) return;
  let busy=false;
  async function refresh() {
    if(busy)return;
    busy=true;
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),25000);
    try {
      const response=await fetch(location.href,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
      if(!response.ok)throw Error('refresh');
      const html=await response.text();
      const updated=new DOMParser().parseFromString(html,'text/html').getElementById('shop-board-live');
      if(!updated)throw Error('session');
      const activeId=board.contains(document.activeElement)?document.activeElement.id:null;
      board.innerHTML=updated.innerHTML;
      if(activeId)document.getElementById(activeId)?.focus({preventScroll:true});
      board.classList.remove('is-stale');
      note.textContent=note.dataset.updated+' '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'});
    } catch {
      board.classList.add('is-stale');
      // Stale ETAs and enabled intake actions must not masquerade as current information.
      board.querySelectorAll('[data-live-eta]').forEach(el=>{el.textContent=note.dataset.unavailable;});
      board.querySelectorAll('[data-intake-link]').forEach(el=>{el.setAttribute('aria-disabled','true');el.removeAttribute('href');});
      note.textContent=note.dataset.failed;
    } finally {clearTimeout(timer);busy=false;}
  }
  const interval=setInterval(refresh,30000);
  window.addEventListener('pagehide',()=>clearInterval(interval),{once:true});
}
module.exports = {script: '<script>('+refreshBoard.toString()+')();</script>'};
