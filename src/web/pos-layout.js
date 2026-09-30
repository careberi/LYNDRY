'use strict';
const { escapeHtml } = require('./layout');

// Decorative line icons; every navigation target also has a visible name.
const paths = {
  orders: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  messages: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  delivery: '<path d="M3 6h11v12H3zM14 10h4l3 4v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
  tools: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  book: '<path d="M12 6C8 3 4 4 3 5v15c3-2 6-2 9 0 3-2 6-2 9 0V5c-3-2-6-2-9 1v14"/>'
};
function posIcon(name) {
  return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name] || paths.tools)+'</svg>';
}
function posChrome({ title, mark, nav, aside, signOut, sidebarIdentity }) {
  return '<a class="pos-skip" href="#pos-main">Skip to workspace</a>' +
    '<header class="pos-topbar"><a class="pos-brand" href="'+escapeHtml(mark.href)+'">LYNDRY<span>POS</span></a>' +
    '<div class="pos-context"><span>Wash &amp; fold</span><span class="pos-context-divider">/</span><strong>'+escapeHtml(title)+'</strong></div>' +
    '<div class="pos-account">'+aside+(signOut ? '<form method="post" action="'+escapeHtml(signOut.action)+'"><button class="btn btn-outline" type="submit">Sign out</button></form>' : '')+'</div></header>' +
    '<aside class="pos-sidebar"><details class="pos-navigation" open><summary>Navigation <span aria-hidden="true">☰</span></summary><nav aria-label="Operations">'+nav+'</nav></details><div class="pos-sidebar-foot">'+(sidebarIdentity ? escapeHtml(sidebarIdentity.name)+'<br><span>'+escapeHtml(sidebarIdentity.address)+'</span>' : 'LYNDRY Operations<br><span>Wash &amp; fold delivery</span>')+'</div></aside>';
}
module.exports = { posIcon, posChrome };
