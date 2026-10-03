'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {book}=require('../src/core/replacement-booking');
const previous={id:'intent',customer_id:'c',blocked_reason:'Expired',updated_at:'old'};
function fixture(result){const calls=[];return {calls,deps:{intents:{openFor:async()=>{calls.push('read');return previous;},completeReplacement:async(...args)=>calls.push(args)},create:async()=>{calls.push('book');return result;},onError:()=>{}}};}
test('successful replacement closes the previously observed blocked checkout with the new order',async()=>{const result={ok:true,order:{id:'o',customer_id:'c'}},f=fixture(result);assert.equal(await book({id:'c'},{},f.deps),result);assert.deepEqual(f.calls,['read','book',[previous,result.order,'c']]);});
for(const result of [{ok:false},{ok:true,needsCard:true},{ok:true,holdRefused:true}])test('unsuccessful or unconfirmed booking preserves unfinished checkout '+JSON.stringify(result),async()=>{const f=fixture(result);await book({id:'c'},{},f.deps);assert.deepEqual(f.calls,['read','book']);});
test('ordinary unblocked checkout is not dismissed',async()=>{const f=fixture({ok:true,order:{id:'o'}});f.deps.intents.openFor=async()=>({...previous,blocked_reason:null});await book({id:'c'},{},f.deps);assert.deepEqual(f.calls,['book']);});
test('cleanup error cannot turn a created order into a failed booking or create it again',async()=>{const result={ok:true,order:{id:'o',customer_id:'c'}},f=fixture(result);f.deps.intents.completeReplacement=async()=>{throw Error('offline');};assert.equal(await book({id:'c'},{},f.deps),result);assert.deepEqual(f.calls,['read','book']);});
