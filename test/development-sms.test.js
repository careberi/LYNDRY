'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sms = require('../src/providers/sms');

const options = {
  enabled: true, railway: true, production: true,
  projectRef: 'psrphpgbiifvnlrgvbdg',
  baseUrl: 'https://lyndry-production-de2c.up.railway.app',
  recipient: '+12025550123',
};

test('development sending requires every deployment guard', () => {
  assert.equal(sms.developmentAllowed(options), true);
  for (const change of [{enabled:false}, {railway:false}, {production:false},
    {projectRef:'pauaemlehenfrnjvgzmc'}, {projectRef:'unknown'},
    {baseUrl:'https://lyndry.com'}, {baseUrl:'http://localhost:3000'}]) {
    assert.equal(sms.developmentAllowed({...options,...change}), false, JSON.stringify(change));
  }
});

test('development driver preserves every app-selected recipient and prefixes every direct send', async () => {
  const calls=[];
  const carrier={sendMessage:async args=>{calls.push(args);return {providerMessageId:'accepted'};}};
  const driver=sms.createDevelopmentDriver(carrier,'+12025550199',options.baseUrl);
  await driver.sendMessage({to:options.recipient,text:'Your code is 123456',from:'+12025550198'});
  assert.equal(calls[0].text,'DEVELOPMENT\nYour code is 123456');
  assert.equal(calls[0].from,'+12025550199');
  assert.equal(calls[0].webhookUrl,options.baseUrl+'/sms');
  await driver.sendMessage({to:options.recipient,text:'DEVELOPMENT\nAlready marked'});
  assert.equal(calls[1].text,'DEVELOPMENT\nAlready marked');
  await driver.sendMessage({to:'+12025550124',text:'Another app-selected recipient'});
  assert.equal(calls[2].to,'+12025550124');
  assert.equal(calls[2].text,'DEVELOPMENT\nAnother app-selected recipient');
  assert.equal(calls.length,3);
});

test('central logging and duplicate checks use the prefixed text for every recipient', async () => {
  const db=require('../src/db');
  const notify=require('../src/core/notify');
  const old={from:db.from,send:sms.sendMessage,prepare:sms.prepareText,isFake:sms.isFake};
  const rows=[],calls=[],comparisons=[];
  const recipient='+12027710000';
  const driver=sms.createDevelopmentDriver({sendMessage:async a=>{calls.push(a);return {providerMessageId:'dev-accepted'};}},'+12025550199',options.baseUrl);
  db.from=()=>({select(){return this;},eq(k,v){if(k==='body')comparisons.push(v);return this;},gt(){return this;},
    maybeSingle:async()=>({data:{status:'ACTIVE'}}),limit:async()=>({data:[]}),
    insert:async r=>{rows.push(r);return {error:null};}});
  Object.assign(sms,{sendMessage:driver.sendMessage,prepareText:driver.prepareText,isFake:false});
  try {
    assert.equal((await notify.sendAndLog(recipient,'Test '+options.baseUrl+'/account','test-customer')).sent,true);
    assert.equal(rows[0].body,calls[0].text);
    assert.equal(comparisons[0],rows[0].body);
    assert.equal(rows[0].body.startsWith('DEVELOPMENT\n'),true);
    assert.equal(rows[0].delivery_status,undefined);
    assert.equal((await notify.sendAndLog('+12027710001','Another recipient','test-customer')).sent,true);
    assert.equal(rows.length,2);
    assert.equal(calls.length,2);
    assert.equal(calls[1].to,'+12027710001');
  } finally {db.from=old.from;Object.assign(sms,{sendMessage:old.send,prepareText:old.prepare,isFake:old.isFake});}
});

test('carrier payload overrides delivery receipts only for development sends', async () => {
  const carrier=require('../src/providers/sms/telnyx');
  const old=global.fetch;const payloads=[];
  global.fetch=async(url,args)=>{payloads.push(JSON.parse(args.body));return {ok:true,json:async()=>({data:{id:'test-id'}})};};
  try {
    await carrier.sendMessage({to:options.recipient,text:'DEVELOPMENT\nTest',webhookUrl:options.baseUrl+'/sms'});
    assert.equal(payloads[0].webhook_url,options.baseUrl+'/sms');
    assert.equal(payloads[0].webhook_failover_url,options.baseUrl+'/sms');
    assert.equal(payloads[0].use_profile_webhooks,false);
    await carrier.sendMessage({to:options.recipient,text:'Production unchanged'});
    assert.equal(Object.hasOwn(payloads[1],'webhook_url'),false);
    assert.equal(Object.hasOwn(payloads[1],'use_profile_webhooks'),false);
  } finally {global.fetch=old;}
});

test('development adds no link filter and does not conceal carrier failures', async () => {
  const driver=sms.createDevelopmentDriver({sendMessage:async()=>{throw Error('carrier unavailable');}},'+12025550199');
  await assert.rejects(driver.sendMessage({to:options.recipient,text:'https://lyndry.com/pay/test'}),/carrier unavailable/);
  await assert.rejects(driver.sendMessage({to:options.recipient,text:'https://pos.lyndry.com/orders'}),/carrier unavailable/);
  await assert.rejects(driver.sendMessage({to:options.recipient,text:options.baseUrl+'/account'}),/carrier unavailable/);
});

test('the new mode never changes production selection', () => {
  assert.equal(sms.pick({configured:true,production:true,realData:true,development:true}),'telnyx');
  assert.equal(sms.pick({configured:true,production:true,realData:false,development:true}),'telnyx-development');
  assert.equal(sms.pick({configured:true,production:false,realData:false,development:true}),'telnyx-grounded');
});
