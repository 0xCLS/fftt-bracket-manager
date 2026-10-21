/** Zero-network device readiness probe using the reviewed origin/capability policy. */
import {assessMilestone1DeviceReadiness} from '../../contracts/milestone1_device_origin_policy.mjs';
const $=id=>document.getElementById(id);
function add(parent,text){const li=document.createElement('li');li.textContent=text;parent.append(li);}
function run(){
 let approved=[];
 const typed=$('approved').value.trim();
 const bad=()=>{$('summary').textContent='NOT READY · the approved origin you typed is not a valid exact HTTPS origin.';
  $('checks').replaceChildren();$('manual').replaceChildren();};
 if(typed)approved=[typed];
 let result;
 try{
  result=assessMilestone1DeviceReadiness({
   href:window.location.href.split('?')[0].split('#')[0],
   pagePath:'/rehearsals/m1/device-check.html',approvedHttpsOrigins:approved,
   isSecureContext:window.isSecureContext,isTopLevel:window.top===window,
   cryptoImpl:window.crypto,tabStorage:window.sessionStorage,isOnline:()=>navigator.onLine,
  });
 }catch{bad();return;}
 $('summary').textContent=result.ready?'READY · every automatic check passed. Complete the manual checks below.':
  'NOT READY · '+result.blockers.length+' blocker(s). Do not attempt staff sign-in on this device.';
 const checks=$('checks'),manual=$('manual');checks.replaceChildren();manual.replaceChildren();
 for(const c of result.checks)add(checks,(c.pass?'✔ ':'✘ ')+c.id.replaceAll('-',' '));
 for(const r of result.blockers.filter(b=>!result.checks.some(c=>c.id===b)))add(checks,'✘ '+r.replaceAll('-',' '));
 for(const m of result.manualChecksRequired)add(manual,m.replaceAll('-',' '));
}
$('check').addEventListener('click',run);
