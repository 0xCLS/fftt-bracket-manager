/** Anonymous public TV/projector board. Public, privacy-projected rows only; never obtains a session.
 * Nothing is requested until Start is pressed on this display. Freshness is recomputed from the
 * clock every second so old results are labelled STALE and later removed, never shown as current.
 */
import {createC3ReadOnlySupabaseTransport} from '../../contracts/phase1c_c3_readonly_supabase_transport.mjs';
import {projectPublishedResults} from '../../contracts/milestone1_public_results.mjs';
import {createMilestone1PublicDisplay} from '../../contracts/milestone1_public_display.mjs';
const PUB='sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0';
const $=id=>document.getElementById(id);
const client=createC3ReadOnlySupabaseTransport({
 publishableKey:PUB,
 getAccessToken:()=>{throw Error('No authenticated session may enter the public display');},
 fetchImpl:(url,init)=>fetch(url,init),
});
const display=createMilestone1PublicDisplay({
 read:()=>client.readPublicResults(),project:projectPublishedResults,
 // C3 transport failures are 'C3 read…'; any other C3 error is an allowlist violation.
 isInvalidData:error=>error?.name==='AuthorityGateError'&&!/^C3 read/.test(error.message),
 isAvailable:()=>navigator.onLine,
});
function add(parent,tag,text,className=''){
 const item=document.createElement(tag);item.textContent=text;
 if(className)item.className=className;
 parent.append(item);return item;
}
function banner(text,kind){const b=$('banner');b.textContent=text;b.className='banner '+kind;}
function render(){
 const v=display.view,target=$('events');
 target.replaceChildren();
 if(!display.running&&v.state==='empty'){banner('NOT STARTED · press Start on this display','idle');return;}
 if(v.state==='empty'){
  banner(v.blankedByInvalidData?'NO CURRENT DATA · display rejected an invalid response':'NO CURRENT DATA · waiting for the organizer\'s feed','empty');
  return;
 }
 const seconds=Math.round(v.ageMs/1000);
 if(v.state==='current')banner('LIVE · updated '+seconds+'s ago','current');
 else banner('STALE · last confirmed '+seconds+'s ago · results may be out of date','stale');
 target.className='events'+(v.state==='stale'?' stale-data':'');
 if(v.events.length===0)add(target,'p','No approved results are published yet.','empty');
 for(const e of v.events){
  const section=add(target,'section','');
  add(section,'h2',e.name);
  add(section,'p',e.date+' · '+e.status,'empty');
  for(const b of e.brackets){
   add(section,'h3',b.name==='championship'?'Championship':'Consolation');
   const grid=add(section,'div','','grid');
   for(const m of b.matches){
    const card=add(grid,'article','','match');
    add(card,'strong',m.players);
    add(card,'span','Round '+m.round+' · '+m.status+(m.winner?' · Winner: '+m.winner:'')+(m.scores?' · '+m.scores:''),'detail');
   }
  }
 }
}
$('start').addEventListener('click',()=>{display.start();render();});
$('stop').addEventListener('click',()=>{display.stop();render();});
setInterval(render,1000);
render();
