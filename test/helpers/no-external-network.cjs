'use strict';
const local = host => ['localhost','127.0.0.1','::1','[::1]'].includes(String(host).toLowerCase());
function guard(input) {
  const host = typeof input==='string'||input instanceof URL ? new URL(input).hostname : input?.hostname || input?.host || 'localhost';
  if (!local(host)) throw Error('External network prohibited by isolated lifecycle test');
}
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,...args)=>{guard(input?.url||input);return originalFetch(input,...args);};
for(const protocol of ['http','https']) {
  const client=require('node:'+protocol);
  for(const method of ['request','get']) {const original=client[method];client[method]=function(input,...args){guard(input);return original.call(this,input,...args);};}
}
const net=require('node:net'),connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const input=Array.isArray(args[0])?args[0][0]:args[0];const host=typeof input==='object'?input.host:typeof args[1]==='string'?args[1]:'localhost';if(!local(host||'localhost'))throw Error('External socket prohibited by isolated lifecycle test');return connect.apply(this,args);};
