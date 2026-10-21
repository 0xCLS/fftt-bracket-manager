/** Milestone 1 synthetic-only PUBLIC spectator / TV display follower.
 * Anonymous, read-only, privacy-projected data ONLY (never a staff token or a
 * private Match Desk row; those use the strict clear-immediately supervisor).
 * An unattended projector must survive a network blip, so the last good public
 * view is kept for a bounded time but is ALWAYS labelled by age: current ->
 * stale -> expired (blank). Freshness is recomputed from the clock on every
 * read of `view`, so stale data can never be mistaken for current.
 * Reads only: no score, publication, mutation, credential or token handling.
 * Invalid or privacy-violating responses blank the display immediately.
 */
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
const fail=reason=>{throw new AuthorityGateError(reason);};
const EMPTY=Object.freeze([]);
export function createMilestone1PublicDisplay({
 read,project,isAvailable,now=()=>Date.now(),
 // Classifies a READ error as unsafe data (blank at once) rather than an outage (age).
 isInvalidData=()=>false,
 setTimer=(fn,ms)=>setTimeout(fn,ms),cancelTimer=id=>clearTimeout(id),
 intervalMs=6000,staleAfterMs=20000,expireAfterMs=120000,maxBackoffMs=60000,
}={}){
 if([read,project,isAvailable,isInvalidData,now,setTimer,cancelTimer].some(f=>typeof f!=='function')
   ||![intervalMs,staleAfterMs,expireAfterMs,maxBackoffMs].every(Number.isSafeInteger)
   ||intervalMs<1000||intervalMs>60000||staleAfterMs<intervalMs
   ||expireAfterMs<=staleAfterMs||expireAfterMs>900000
   ||maxBackoffMs<intervalMs||maxBackoffMs>300000)
  fail('Explicit public display dependencies and bounded timings required');
 let last=null,running=false,epoch=0,inFlight=false,timer=null;
 let failures=0,successes=0,blankedByData=false;
 const cancel=()=>{if(timer!==null){cancelTimer(timer);timer=null;}};
 const schedule=ms=>{cancel();if(running){const stamp=epoch;
  timer=setTimer(()=>{timer=null;if(stamp===epoch)void tick();},ms);}};
 async function tick(){
  if(!running||inFlight)return;
  let available=false;
  try{available=isAvailable()===true;}catch{available=false;}
  if(!available){schedule(intervalMs);return;} // hidden/offline: no read, view just ages
  const stamp=epoch;inFlight=true;
  const backoff=()=>Math.min(intervalMs*2**Math.min(failures,10),maxBackoffMs);
  try{
   let rows;
   try{rows=await read();}
   catch(error){
    if(stamp!==epoch)return;
    failures++;
    let unsafe=false;
    try{unsafe=isInvalidData(error)===true;}catch{unsafe=true;}
    // outage: keep the aged public view, never refresh its timestamp;
    // an allowlist violation reported by the reader blanks like a projection failure
    if(unsafe){last=null;blankedByData=true;}
    schedule(backoff());return;
   }
   if(stamp!==epoch)return; // stopped or restarted while in flight
   let view;
   try{view=project(rows);} // throws on any private/extra/malformed field
   catch{ // unsafe or invalid data is removed at once, not aged
    last=null;blankedByData=true;failures++;schedule(backoff());return;
   }
   last=Object.freeze({view,at:now()});
   failures=0;successes++;blankedByData=false;
   schedule(intervalMs);
  }finally{if(stamp===epoch)inFlight=false;}
 }
 const computeView=()=>{
  if(last===null)return Object.freeze({state:'empty',events:EMPTY,ageMs:null,
   readOnly:true,consecutiveFailures:failures,blankedByInvalidData:blankedByData});
  const age=now()-last.at;
  // A clock that moved backwards cannot prove freshness: fail closed.
  if(age<0||age>expireAfterMs){last=null;return computeView();}
  return Object.freeze({state:age<=staleAfterMs?'current':'stale',events:last.view,
   ageMs:age,readOnly:true,consecutiveFailures:failures,blankedByInvalidData:false});
 };
 return Object.freeze({
  start(){if(running)return false;running=true;epoch++;void tick();return true;},
  stop(){running=false;epoch++;inFlight=false;cancel();last=null;blankedByData=false;},
  /** Operator-pressed refresh; shares the single in-flight guard. */
  refreshNow(){if(running){cancel();void tick();}},
  get view(){return computeView();},
  get running(){return running;},
  get stats(){return Object.freeze({successes,failures,readOnly:true});},
 });
}
