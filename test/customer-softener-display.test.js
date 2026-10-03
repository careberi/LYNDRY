'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/routes/admin'),'utf8');
const expression=source.match(/\$\{(detail\('Fabric softener',[^\n]+)\}/)[1];
for(const [value,want]of [['NONE','No softener'],['STANDARD','Standard scented'],[undefined,'Not set'],['unexpected','Not set']])test('POS profile correctly shows softener '+String(value),()=>{
const text=vm.runInNewContext(expression,{prefs:{fabric_softener:value},wash:require('../src/core/wash'),detail:(_label,text)=>text});assert.equal(text,want);
});
