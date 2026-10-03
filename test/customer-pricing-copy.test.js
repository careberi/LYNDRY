'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');const filename=require.resolve('../src/core/intake');const load=createRequire(filename);const source=fs.readFileSync(filename,'utf8');
function text(development){const mod={exports:{}};vm.runInNewContext(source,{module:mod,require:id=>id==='../config'?{config:{supabase:{isDevelopment:development}}}:load(id),console});return mod.exports.FIELDS.find(f=>f.key==='service_type').text({name:'QA Customer'});}
test('new development service draft invites price review without inventing fixed rates',()=>{const draft=text(true);assert.doesNotMatch(draft,/\$[\d.]+\s*\/lb/);assert.match(draft,/review.*price|price.*review/i);assert.match(draft,/one-time/i);assert.match(draft,/subscription/i);});
test('production service draft retains its existing rates',()=>{const draft=text(false);assert.match(draft,/\$2\.00\/lb/);assert.match(draft,/\$1\.80\/lb/);});

function publicPage(file,development){const f=require.resolve('../src/web/site'),req=createRequire(f),mod={exports:{}};const current=req('../config');vm.runInNewContext(fs.readFileSync(f,'utf8'),{module:mod,require:id=>id==='../config'?{config:{...current.config,supabase:{...current.config.supabase,isDevelopment:development}}}:req(id),console,process});const lf=require.resolve('../src/web/layout'),lr=createRequire(lf),layout={exports:{}};vm.runInNewContext(fs.readFileSync(lf,'utf8'),{module:layout,require:id=>id==='./site'?mod.exports:lr(id),__dirname:require('node:path').dirname(lf),console,process});return layout.exports.renderPage({title:'Pricing',path:'/',body:fs.readFileSync(require('node:path').join(__dirname,'../public/pages',file),'utf8')});}
for(const file of ['home.html','faq.html']){
 test(file+' explains inclusive development allowance and weight limit',()=>{const html=publicPage(file,true);assert.match(html,/18 lb/);assert.match(html,/50 lb/);assert.match(html,/included/i);assert.doesNotMatch(html,/see your (?:current price per pound|per-pound rate), operational fee/);});
 test(file+' retains production fee explanation',()=>{const html=publicPage(file,false);assert.match(html,/operational fee/);assert.doesNotMatch(html,/18 lb.*allowance/);});
}

