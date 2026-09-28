const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerAdmin, body } = require('../src/routes/shipday-routes');
test('page escapes vendor and address text and never claims dispatch is enabled', () => {
  const html = body({ configured: true, services: [{ name: '<script>bad</script>', status: true, prod: true }], from: '\"><script>', activeProvider: 'uber-test' });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /Live dispatch disabled/);
  assert.match(html, /Configured/);
});
test('Shipday controls require permissions and same-origin POST; checks never mutate deliveries', async (t) => {
  const app = express(); app.use(express.urlencoded({ extended: false }));
  let checks = 0, quotes = 0;
  registerAdmin(app, { guard: (req,res,next) => { req.opsUser={}; next(); },
    may: (permission) => (req,res,next) => { assert.equal(permission,'service.manage'); if(req.get('x-admin') !== 'yes') return res.sendStatus(403); next(); },
    configured: true, activeProvider: 'uber-test', adminPage: ({body}) => '<!doctype html>'+body,
    client: { services: async () => { checks++; return [{name:'Uber',status:true,prod:true}]; }, quote: async () => {quotes++;return {ok:false};} } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r=>server.once('listening',r)); t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/ops/shipday')).status,403);
  assert.equal((await fetch(base+'/ops/shipday/check',{method:'POST',headers:{'x-admin':'yes'}})).status,403);
  assert.equal(checks,0);
  const checked = await fetch(base+'/ops/shipday/check',{method:'POST',redirect:'manual',headers:{'x-admin':'yes',origin:base}});
  assert.equal(checked.status,303); assert.equal(checks,1);
  const html=await (await fetch(base+'/ops/shipday',{headers:{'x-admin':'yes'}})).text();
  assert.match(html,/Last successful check/); assert.match(html,/Uber/);
  await fetch(base+'/ops/shipday/quote',{method:'POST',headers:{'x-admin':'yes',origin:base,'content-type':'application/x-www-form-urlencoded'},body:'from=&to='});
  assert.equal(quotes,0);
  const quote=await fetch(base+'/ops/shipday/quote',{method:'POST',headers:{'x-admin':'yes',origin:base,'content-type':'application/x-www-form-urlencoded'},body:'from=1+Test+St&to=2+Test+St'});
  assert.equal(quotes,1); assert.match(await quote.text(),/No confirmed estimate/);
});
