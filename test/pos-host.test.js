'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { posHost, publicPath, htmlUrls, configuredPosHost } = require('../src/web/pos-host');

test('POS hostname defaults follow database identity and accept an explicit hostname',()=>{
  assert.equal(configuredPosHost('', 'psrphpgbiifvnlrgvbdg'), 'pos-dev.lyndry.com');
  assert.equal(configuredPosHost('', 'pauaemlehenfrnjvgzmc'), 'pos.lyndry.com');
  assert.equal(configuredPosHost(' POS-TEST.LYNDRY.COM ', ''), 'pos-test.lyndry.com');
  for(const value of ['https://pos-dev.lyndry.com','pos-dev.lyndry.com/path','pos-dev.lyndry.com:3000','bad host']) assert.throws(()=>configuredPosHost(value,''),/POS_HOST/);
});

test('Railway development POS serves staff pages, login and actions on its own host',async t=>{
  const host=configuredPosHost('', 'psrphpgbiifvnlrgvbdg');
  const request=await fixture(t,{host,publicOrigin:'https://lyndry-production-de2c.up.railway.app'});
  assert.match((await request('/',{host})).text,/href="\/customers"/);
  assert.equal((await request('/customers',{host})).text,'<!doctype html><h1>Customers</h1>');
  assert.equal((await request('/customers',{host:'lyndry-production-de2c.up.railway.app'})).text,'PUBLIC SITE');
  assert.equal((await request('/customers',{host:host+'.attacker.test'})).text,'PUBLIC SITE');
  assert.equal((await request('/customers',{host:'pos.localhost:3000'})).status,200);
  const login=await request('/login',{host,method:'POST'});
  assert.equal(login.headers.location,'/customers?note=saved');
  assert.match(login.headers['set-cookie'][0],/Path=\/;/);
  assert.doesNotMatch(login.headers['set-cookie'][0],/Domain=/);
  const action=await request('/action',{host,method:'POST',body:'value=unchanged'});
  assert.deepEqual(JSON.parse(action.text),{value:'unchanged',path:'/ops/action'});
});

async function fixture(t, options = {}) {
  const app = express();
  app.use(posHost(options));
  app.use(express.urlencoded({ extended: false }));
  app.get('/ops', (req, res) => res.send('<!doctype html><a href="/ops/customers">Customers</a>'));
  app.get('/ops/protected', (req, res) => res.redirect('/ops/login?next='+encodeURIComponent(req.originalUrl)));
  app.get('/ops/login', (req, res) => res.send('<!doctype html><form action="/ops/login"><input name="next" value="/ops/customers"></form>'));
  app.post('/ops/login', (req, res) => {
    res.cookie('ly_ops', 'test-session', { path: '/ops', httpOnly:true, sameSite:'strict', secure:true });
    res.redirect(303, '/ops/customers?note=saved');
  });
  app.post('/ops/logout', (req, res) => { res.clearCookie('ly_ops', {path:'/ops'}); res.redirect(303, '/ops/login'); });
  app.post('/ops/action', (req, res) => res.json({value:req.body.value,path:req.path}));
  app.get('/ops/today', (req, res) => res.status(401).json({error:'Unauthorized'}));
  app.get('/ops/customers', (req, res) => res.send('<!doctype html><h1>Customers</h1>'));
  app.get('/ops/app.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify({start_url:'/ops/run',scope:'/ops',icons:[{src:'/app-icon-192.png'}]})));
  app.get(['/css/test.css','/favicon-48.png','/app-icon-192.png','/health'], (req,res)=>res.send('asset'));
  app.get('/customers', (req,res)=>res.send('PUBLIC SITE'));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return (path, {host='pos.lyndry.com',method='GET',body=''}={})=>new Promise((resolve,reject)=>{
    const request=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,agent:false,headers:{host,'content-type':'application/x-www-form-urlencoded','content-length':Buffer.byteLength(body)}},response=>{
      let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,text}));
    });request.on('error',reject);request.end(body);
  });
}

test('POS URLs retain query strings, fragments and root slash',()=>{
  assert.equal(publicPath('/ops?date=2026-09-27'), '/?date=2026-09-27');
  assert.equal(publicPath('/ops/orders/42#payment'), '/orders/42#payment');
  assert.equal(publicPath('/ops'), '/');
  assert.equal(publicPath('/ops-other'), '/ops-other');
  assert.equal(publicPath('https://example.org/ops'), 'https://example.org/ops');
});
test('HTML migration changes URLs but preserves message text and internal next values',()=>{
  const input='<a href="/ops/customers/42?x=1&amp;y=2">/ops/customers</a><form action="/ops/login"><input value="/ops/customers"></form><textarea>/ops/message</textarea><a href="/p/42">Photo</a>';
  const out=htmlUrls(input);
  assert.ok(out.includes('href="/customers/42?x=1&amp;y=2"'));
  assert.ok(out.includes('action="/login"'));
  assert.ok(out.includes('value="/ops/customers"'));
  assert.ok(out.includes('<textarea>/ops/message</textarea>'));
  assert.ok(out.includes('href="https://lyndry.com/p/42"'));
});
test('POS root and staff paths reach existing ops handlers',async t=>{
  const request=await fixture(t);
  assert.ok((await request('/')).text.includes('href="/customers"'));
  assert.equal((await request('/customers')).text, '<!doctype html><h1>Customers</h1>');
  assert.equal((await request('/customers',{host:'pos.localhost:3000'})).status,200);
  assert.equal((await request('/customers',{host:'lyndry.com'})).text,'PUBLIC SITE');
  assert.equal((await request('/customers',{host:'pos.lyndry.com.attacker.test'})).text,'PUBLIC SITE');
});
test('sign-in preserves the intended protected page and query',async t=>{
  const request=await fixture(t);const result=await request('/protected?day=Monday');
  assert.equal(result.headers.location,'/login?next=%2Fops%2Fprotected%3Fday%3DMonday');
});
test('POS login and logout set and clear host-only root cookies without weakening flags',async t=>{
  const request=await fixture(t);const result=await request('/login',{method:'POST'});
  assert.equal(result.status,303);assert.equal(result.headers.location,'/customers?note=saved');
  const cookie=result.headers['set-cookie'][0];
  assert.match(cookie,/Path=\//);assert.doesNotMatch(cookie,/Path=\/ops|Domain=/);
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
  const logout=await request('/logout',{method:'POST'});
  assert.match(logout.headers['set-cookie'][0],/Path=\/;/);assert.match(logout.headers['set-cookie'][0],/Expires=Thu, 01 Jan 1970/);
});
test('existing website login retains its original cookie path',async t=>{
  const request=await fixture(t);const result=await request('/ops/login',{host:'lyndry.com',method:'POST'});
  assert.match(result.headers['set-cookie'][0],/Path=\/ops/);assert.equal(result.headers.location,'/ops/customers?note=saved');
});
test('POST data and existing API aliases are never redirected or replayed',async t=>{
  const request=await fixture(t,{redirectLegacy:true});
  for(const host of ['pos.lyndry.com','lyndry.com']) {
    const result=await request('/ops/action',{host,method:'POST',body:'value=unchanged'});
    assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.text),{value:'unchanged',path:'/ops/action'});
    const api=await request('/ops/today',{host});assert.equal(api.status,401);assert.equal(api.headers.location,undefined);
  }
});
test('old POS browser paths canonicalize without losing query state',async t=>{
  const request=await fixture(t);const result=await request('/ops/customers?q=Sam');
  assert.equal(result.status,302);assert.equal(result.headers.location,'/customers?q=Sam');
});
test('legacy domain migration is opt-in and restricted to browser HTML',async t=>{
  const off=await fixture(t);assert.equal((await off('/ops',{host:'lyndry.com'})).status,200);
  const on=await fixture(t,{redirectLegacy:true});
  assert.equal((await on('/ops?date=2026-09-27',{host:'lyndry.com'})).headers.location,'https://pos.lyndry.com/?date=2026-09-27');
  assert.equal((await on('/ops',{host:'localhost:3000'})).status,410);
});

test('local website retires every old ops entry point before login, reads or mutations',async t=>{
  const request=await fixture(t);
  for(const path of ['/ops','/ops/','/ops?date=2026-09-28','/ops/login','/ops/customers','/ops/orders/9016','/ops/today','/ops/action','/OPS/customers']) {
    for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE']) {
      const result=await request(path,{host:'localhost:3000',method,body:method==='GET'||method==='HEAD'?'':'value=unchanged'});
      assert.equal(result.status,410,method+' '+path);
      assert.equal(result.headers.location,undefined);
      assert.equal(result.headers['set-cookie'],undefined);
    }
  }
  assert.equal((await request('/customers',{host:'localhost:3000'})).text,'PUBLIC SITE');
  assert.equal((await request('/health',{host:'localhost:3000'})).text,'asset');
  assert.equal((await request('/ops/customers',{host:'lyndry-production-de2c.up.railway.app'})).status,200);
  assert.equal((await request('/customers',{host:'pos.localhost:3000'})).status,200);
  const action=await request('/action',{host:'pos.localhost:3000',method:'POST',body:'value=unchanged'});
  assert.equal(action.status,200);
  assert.deepEqual(JSON.parse(action.text),{value:'unchanged',path:'/ops/action'});
  assert.equal((await request('/ops/today',{host:'pos.localhost:3000'})).status,401);
});
test('manifest uses the new scope and assets remain reachable',async t=>{
  const request=await fixture(t);const manifest=await request('/app.webmanifest');
  assert.equal(JSON.parse(manifest.text).scope,'/');assert.equal(JSON.parse(manifest.text).start_url,'/run');
  for(const path of ['/css/test.css','/favicon-48.png','/app-icon-192.png','/health']) assert.equal((await request(path)).text,'asset');
});

test('staff and public partner links remain distinct on the POS host',()=>{
  assert.equal(htmlUrls('<a href="/ops/partners">Staff</a><a href="/partners">Public</a>'), '<a href="/partners">Staff</a><a href="https://lyndry.com/partners">Public</a>');
});
