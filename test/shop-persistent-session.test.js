'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../src/core/partner-auth'),'utf8');
function fixture(){
 let now=1000000;
 const context={crypto:require('node:crypto'),Buffer,config:{adminApiKey:'test-only-key'},Date:{now:()=>now},SESSION_MS:400*86400000};
 vm.createContext(context);
 for(const [start,end] of [['function sameSecret(', '// KEYED'],['function hmac(', '// --- The session'],['function newSessionToken(', 'function readCookie(']]) {
  vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),context);
 }
 return {context,advance:()=>{now+=800*86400000;}};
}
test('shop session has no application age limit',()=>{
 const {context,advance}=fixture();const cookie=context.issueSession('user','token');
 advance();assert.equal(context.readSession(cookie.value).token,'token');
 assert.equal(cookie.maxAgeMs,400*86400000);
});
test('persistent cookie still rejects tampering',()=>{
 const {context}=fixture();const cookie=context.issueSession('user','token');
 assert.equal(context.readSession(cookie.value.replace('token','other')),null);
});
test('legacy expired cookies are not revived',()=>{
 const {context}=fixture();const payload='user.1.token';
 assert.equal(context.readSession(payload+'.'+context.hmac(payload)),null);
});

test('login elsewhere rejects the previous shop session',async()=>{
 const context={config:{adminApiKey:'key'},COOKIE_NAME:'ly_shop',URLSearchParams,
 readCookie:()=>'',readSession:()=>({userId:'user',token:'old'}),
 sameSecret:(a,b)=>a===b,clearSessionCookie:()=>{},
 db:{from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:{id:'user',status:'ACTIVE',session_token:'new'}};}})}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('async function requirePartner('),source.indexOf('module.exports =')),context);
 let target;await context.requirePartner({originalUrl:'/shop'},{redirect:(code,url)=>{target=url;}},()=>assert.fail('old session allowed'));
 assert.equal(target,'/shop/login?why=elsewhere');
});
