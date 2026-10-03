'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/routes/account'),'utf8');
const body=source.slice(source.indexOf('function settingsPage('),source.indexOf("router.get('/account/address'"));
const settings=vm.runInNewContext(body+';settingsPage',{escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),banner:s=>'<p role="alert">'+s+'</p>'});
for(const title of ['Your address','Wash preferences','Your payment card'])test(title+' settings render without a booking step',()=>{
 const html=settings({title,blurb:'Saved settings',form:'<form><input name="saved"></form>',error:'Check <address>'});
 assert.match(html,new RegExp(title));assert.match(html,/<form>/);assert.match(html,/Check &lt;address>/);assert.match(html,/Back to your account/);
});

