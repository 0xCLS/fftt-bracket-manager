import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../integrations/google-apps-script/Code.gs',import.meta.url),'utf8');
function runtime({today='2026-11-18',code=204,token=true}={}) {
 const calls=[],props=new Map(token?[['FFTT_GITHUB_ACTIONS_TOKEN','private-fake-token']]:[]);
 const triggers=[],sheetName='Form Responses 1';
 const tab={getName:()=>sheetName,getRange:()=>({getDisplayValues:()=>[['Timestamp','Full Name']]})};
 const sheet={getId:()=> 'original-sheet-id',getSheetByName:n=>n===sheetName?tab:null};
 const t=(name,id)=>({getHandlerFunction:()=>name,getTriggerSourceId:()=>id});
 const context={Date,JSON,console:{log(){}},
   SpreadsheetApp:{getActiveSpreadsheet:()=>sheet},
   PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},
   Utilities:{formatDate:()=>today},
   UrlFetchApp:{fetch:(url,opts)=>{calls.push({url,opts});return{getResponseCode:()=>code}} },
   ScriptApp:{getProjectTriggers:()=>triggers.slice(),deleteTrigger:x=>triggers.splice(triggers.indexOf(x),1),
     newTrigger:name=>({
       forSpreadsheet:s=>({onFormSubmit:()=>({create:()=>triggers.push(t(name,s.getId()))})}),
       timeBased:()=>({everyHours:()=>({create:()=>triggers.push(t(name,null))})})
     })}
 };
 vm.createContext(context);vm.runInContext(source,context,{filename:'Code.gs'});
 return {context,calls,triggers,event:{source:sheet,range:{getSheet:()=>tab},values:['secret name','secret email']}};
}
test('idempotent install and cleanup preserves unrelated triggers',()=>{
 const r=runtime(),other={getHandlerFunction:()=> 'other'};r.triggers.push(other);
 r.context.ffttInstallTriggers();r.context.ffttInstallTriggers();assert.equal(r.triggers.length,3);
 r.context.ffttRemoveTriggers();assert.deepEqual(r.triggers,[other]);
});
test('submit dispatch contains no registration data',()=>{
 const r=runtime();r.context.ffttInstallTriggers();r.context.ffttOnFormSubmit(r.event);
 assert.equal(r.calls.length,1);const {url,opts}=r.calls[0];
 assert.match(url,/github\.com\/repos\/0xCLS\/fftt-bracket-manager\/actions\/workflows\/public-registration-count\.yml\/dispatches/);
 assert.equal(opts.payload,'{"ref":"main"}');assert.equal(opts.followRedirects,false);
 assert.equal(opts.muteHttpExceptions,true);assert.ok(!JSON.stringify(opts).includes('secret name'));
 assert.ok(!JSON.stringify(opts).includes('secret email'));
});
test('invalid source or wrong tab does not dispatch',()=>{
 const r=runtime();r.context.ffttInstallTriggers();
 assert.throws(()=>r.context.ffttOnFormSubmit(),/form-submission/);
 assert.throws(()=>r.context.ffttOnFormSubmit({...r.event,source:{getId:()=> 'wrong'}}),/unexpected spreadsheet/);
 r.context.ffttOnFormSubmit({...r.event,range:{getSheet:()=>({getName:()=> 'Other'})}});
 assert.equal(r.calls.length,0);
});
test('hourly reconciliation and manual smoke check use existing dispatcher',()=>{
 const r=runtime();r.context.ffttInstallTriggers();r.context.ffttReconcile();r.context.ffttVerifyDispatch();
 assert.equal(r.calls.length,2);assert.equal(r.calls[0].opts.payload,'{"ref":"main"}');
});
test('after event cutoff no dispatch happens',()=>{
 const r=runtime({today:'2026-11-24'});r.context.ffttInstallTriggers();
 r.context.ffttOnFormSubmit(r.event);r.context.ffttReconcile();r.context.ffttVerifyDispatch();
 assert.equal(r.calls.length,0);
});
test('missing token prevents install; 403 errors never leak token',()=>{
 const a=runtime({token:false});assert.throws(()=>a.context.ffttInstallTriggers(),/TOKEN/);
 const r=runtime({code:403});r.context.ffttInstallTriggers();
 assert.throws(()=>r.context.ffttOnFormSubmit(r.event),e=>/HTTP 403/.test(e.message)&&!e.message.includes('private-fake-token'));
});
