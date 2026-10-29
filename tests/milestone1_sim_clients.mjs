/** Isolated simulated devices for the Milestone 1 acceptance harness.
 * Every client owns its tab storage, PKCE vault, transport and staff session;
 * only the disposable SimCloud is shared. All modules under test are real.
 */
import {createMilestone1PkceGuard} from '../contracts/milestone1_pkce_guard.mjs';
import {createMilestone1BrowserPkcePrimitives} from '../contracts/milestone1_pkce_browser_adapter.mjs';
import {createMilestone1PkceSupabaseTransport} from '../contracts/milestone1_pkce_supabase_transport.mjs';
import {createMilestone1PkceStaffSession} from '../contracts/milestone1_pkce_staff_session.mjs';
import {createMilestone1ScoreSession} from '../contracts/milestone1_score_session.mjs';
import {createMilestone1ReadSupervisor} from '../contracts/milestone1_read_supervisor.mjs';
export const REDIRECT='http://localhost:3000/rehearsals/m1/hosted-pkce.html';
const KEY='sb_publishable_synthetic_test_key_1234';
export function tabStorage(){
 const m=new Map();
 return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),
  removeItem:k=>m.delete(k),get size(){return m.size},dump:()=>[...m.values()].join('\n')};
}
/** Timer double: nothing runs until the test advances it. */
export function fakeTimers(){
 let id=0;const jobs=new Map();
 return {setTimer:(fn,ms)=>{jobs.set(++id,{fn,ms});return id;},
  cancelTimer:i=>jobs.delete(i),pending:()=>jobs.size,
  async fire(){const list=[...jobs.entries()];jobs.clear();
   for(const [,j] of list)await j.fn();await new Promise(r=>setImmediate(r));}};
}
export function makeStaffClient(cloud,name,{backgroundGraceMs=0}={}){
 const net=cloud.client(name),tabs=tabStorage();
 const state={online:true,hidden:false,token:null};
 const pkce=createMilestone1PkceGuard({redirectUri:REDIRECT,now:cloud.now,
  ...createMilestone1BrowserPkcePrimitives({cryptoImpl:globalThis.crypto,tabStorage:tabs})});
 const base=createMilestone1PkceSupabaseTransport({publishableKey:KEY,
  allowSyntheticAuthNetwork:true,fetchImpl:net.fetch});
 // Test-only tap so the simulated scorer can sign as this device. The page
 // under test never exposes its token; the harness stands in for a signed device.
 const transport=Object.freeze({...base,async exchangeCode(a){
  const r=await base.exchangeCode(a);state.token=r.access_token;return r;}});
 const isOnline=()=>state.online&&!state.hidden;
 const session=createMilestone1PkceStaffSession({pkce,transport,redirectUri:REDIRECT,
  isOnline,now:cloud.now,backgroundGraceMs});
 const api={
  name,session,transport,tabs,state,
  setOnline(v){state.online=v;net.setOnline(v);},
  setHidden(v){state.hidden=v;},
  net,
  async requestLink(email){return session.begin(email);},
  async completeFromMail(email,eventId){
   const callback=cloud.openEmailLink(email);
   if(!callback)throw new Error('no mail');
   return session.complete(callback,{eventId});
  },
  async signIn(email,eventId){await session.begin(email);return api.completeFromMail(email,eventId);},
  /** Real signed score session for this device (disposable local simulation gate). */
  scoreSession(eventId,{loseResponse=()=>false,ids}={}){
   let n=0;let sent=0;
   const tag=[...name].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7).toString(16).padStart(12,'0');
   const uuid=()=>ids?.[n++]??`${(++n).toString(16).padStart(8,'0')}-5555-4555-8555-${tag}`;
   const rig=createMilestone1ScoreSession({
    eventId,
    readRole:()=>transport.readRole({eventId,token:state.token}),
    readMatchdesk:()=>transport.readMatchdesk({eventId,token:state.token}),
    readOwnSnapshot:({submissionId})=>cloud.ownSnapshot(state.token,{eventId,submissionId}),
    sendScore:async intent=>{
     sent++;
     const r=cloud.submitScore(state.token,intent);
     if(loseResponse())throw new Error('response lost after commit');
     return r;
    },
    getSubmissionId:uuid,
    isAuthenticated:()=>session.status.authenticated,
    allowDisposableLocalSimulation:true,
   });
   return {rig,sent:()=>sent};
  },
 };
 return api;
}
/** Read-only supervisor that follows a client's private Match Desk. */
export function followDesk(client,eventId,timers,sink){
 return createMilestone1ReadSupervisor({
  read:()=>client.session.readDesk(),
  accept:v=>v?.status==='ready'&&v.authoritativeForScoring===false,
  present:v=>sink.push({type:'present',revision:v.revision,matches:v.matches.length,role:v.role}),
  clear:reason=>sink.push({type:'clear',reason}),
  isAvailable:()=>client.state.online&&!client.state.hidden,
  setTimer:timers.setTimer,cancelTimer:timers.cancelTimer,intervalMs:6000,
 });
}
