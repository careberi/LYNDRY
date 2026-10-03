'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('pickup and return lifecycle regression suites run with external network prohibited',()=>{
const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
const preload=path.join(__dirname,'helpers/no-external-network.cjs');
const tripwire=spawnSync(process.execPath,['--require',preload,'-e',"fetch('https://external.invalid/driver').catch(()=>process.exit(0))"],{encoding:'utf8',timeout:10000});
assert.notEqual(tripwire.status,0,'tripwire must synchronously reject the forbidden call');assert.match(tripwire.stderr,/External network prohibited/);
const files=['collectable','reminder-collectable','admin-portal-access','payment-hold','partner-intake','partner-return','shipday-booking-runtime','shipday-booking-dispatch','shipday-cancellation','shipday-proof','booking-intent','account-booking-review','pos-development-quote'];
const result=spawnSync(process.execPath,['--require',preload,'--test',...files.map(f=>path.join(__dirname,f+'.test.js'))],{encoding:'utf8',timeout:60000,env:childEnv});assert.equal(result.status,0,(result.stdout+'\n'+result.stderr).slice(-10000));assert.match(result.stdout, /tests [1-9][0-9]+/, 'the child must actually execute its regression suites');
});


