'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const db=require('../src/db'),sms=require('../src/providers/sms');
const {sendAndLog}=require('../src/core/notify');
test('no provider tracking URLs leave the central customer SMS gate',async()=>{
 const original=db.from;db.from=()=>{throw Error('Must refuse before any send or query');};
 try{for(const body of ['Track https://ordertracking.io/d/en/x/abcd','Visit HTTPS://REPORT.SHIPDAY.COM/foo']){
  assert.deepEqual(await sendAndLog('+12015550101',body,'customer'),{sent:false,refused:'internal_tracking_link'});
 }}finally{db.from=original;}
});
test('delivery worker can distinguish sent, opted out and uncertain provider results',async()=>{
 const originalFrom=db.from,originalSend=sms.sendMessage;
 let optedOut=false,fail=false,calls=0;
 db.from=table=>({select(){return this;},eq(){return this;},gt(){return this;},
  maybeSingle:async()=>({data:{status:optedOut?'UNSUBSCRIBED':'ACTIVE'}}),
  limit:async()=>({data:[]}),insert:async()=>({error:null})});
 sms.sendMessage=async()=>{calls++;if(fail)throw Error('timeout');return {providerMessageId:'test-id'};};
 try{
  optedOut=true;assert.equal((await sendAndLog('+12017710000','LYNDRY test','customer')).refused,'opted_out');assert.equal(calls,0);
  optedOut=false;assert.equal((await sendAndLog('+12017710000','LYNDRY test','customer')).sent,true);
  fail=true;assert.equal((await sendAndLog('+12017710000','LYNDRY test','customer')).uncertain,true);
 }finally{db.from=originalFrom;sms.sendMessage=originalSend;}
});
