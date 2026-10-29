/** Anonymous public-only spectator reader; never obtains signed sessions. */
import {createC3ReadOnlySupabaseTransport} from '../../contracts/phase1c_c3_readonly_supabase_transport.mjs';
import {projectPublishedResults} from '../../contracts/milestone1_public_results.mjs';
import {createMilestone1ReadSupervisor} from '../../contracts/milestone1_read_supervisor.mjs';
const PUB='sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0';
const $=id=>document.getElementById(id);
const client=createC3ReadOnlySupabaseTransport({
 publishableKey:PUB,
 getAccessToken:()=>{throw Error('No authenticated session may enter public screen');},
 fetchImpl:(url,init)=>fetch(url,init),
});
function add(parent,tag,text,className=''){
 const item=document.createElement(tag);item.textContent=text;
 if(className)item.className=className;
 parent.append(item);return item;
}
function render(events){
 const target=$('events');target.replaceChildren();
 if(events.length===0){add(target,'p','No publicly approved synthetic events yet.','empty');return;}
 for(const e of events){
  const section=add(target,'section','','event');
  add(section,'h3',e.name);
  add(section,'p',e.date+' · '+e.status,'meta');
  if(e.brackets.length===0)add(section,'p','No public bracket matches yet.','empty');
  for(const b of e.brackets){
    add(section,'h4',b.name==='championship'?'Championship':'Consolation');
    if(!b.matches.length)add(section,'p','No published matches in this bracket.','empty');
    for(const m of b.matches){
      const item=add(section,'article','','match');
      add(item,'strong',m.players);
      add(item,'p','Round '+m.round+' · '+m.status+
        (m.winner?' · Winner: '+m.winner:'')+
        (m.scores?' · '+m.scores:''),'detail');
    }
  }
 }
}
const supervisor=createMilestone1ReadSupervisor({
 read:async()=>projectPublishedResults(await client.readPublicResults()),
 accept:events=>Array.isArray(events)&&events.length<=20,
 present:events=>{
   render(events);
   $('status').textContent='Public read-only view current · '+events.length+
     ' approved event(s) · next check in 6 seconds.';
 },
 clear:reason=>{
   $('events').replaceChildren();
   $('status').textContent='Public display cleared · '+reason+
     '. Use Start for a fresh read; no data is cached.';
 },
 isAvailable:()=>navigator.onLine&&!document.hidden,
 intervalMs:6000,
});
$('start').addEventListener('click',()=>{
 if(!supervisor.start())$('status').textContent=
  'Already reading or unavailable. No automatic retry.';
});
$('pause').addEventListener('click',()=>supervisor.pause('manually paused'));
window.addEventListener('offline',()=>supervisor.pause('offline'));
document.addEventListener('visibilitychange',()=>{
 if(document.hidden)supervisor.pause('tab hidden');
});
