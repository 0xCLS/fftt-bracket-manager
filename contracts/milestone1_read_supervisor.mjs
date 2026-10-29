/** Milestone 1 synthetic-only, READ-ONLY live-view supervisor.
 *
 * Explicitly injected authenticated/read-only or anonymous/public reader.
 * A timer may trigger further GET/snapshot reads, NEVER any score RPC.
 * Private and public callers must validate, strip, and render their own
 * allowlisted views. No token/payload persistence, Realtime write, queue,
 * replay, automatic sign-in, privileged API, or fallback promotion.
 * Any failure, expiry, hidden tab or network loss clears visible state and
 * stays stopped until an explicit human Restart.
 */
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
const fail=reason=>{throw new AuthorityGateError(reason);};
export function createMilestone1ReadSupervisor({
  read,accept,present,clear,isAvailable,
  setTimer=(fn,ms)=>setTimeout(fn,ms),
  cancelTimer=id=>clearTimeout(id),
  intervalMs=6000,
}={}){
  if([read,accept,present,clear,isAvailable,setTimer,cancelTimer]
       .some(f=>typeof f!=='function')
    ||!Number.isSafeInteger(intervalMs)||intervalMs<1000||intervalMs>60000)
    fail('Explicit read-only supervisor dependencies required');
  let current=false,disposed=false,token=0,inFlight=false,timeout=null,priorRevision=null;
  let successes=0,failures=0;
  const cancel=()=>{if(timeout!==null){cancelTimer(timeout);timeout=null;}};
  function pause(reason='paused'){
    current=false;token++;inFlight=false;priorRevision=null;cancel();
    clear(reason);return Object.freeze({status:reason});
  }
  async function refresh(){
    if(disposed||!current||inFlight)return;
    if(!isAvailable()){pause('unavailable');return;}
    const stamp=token;inFlight=true;
    try{
      // Remove the last private/public view before network I/O: no stale
      // authority after an in-flight revision change.
      clear('refreshing');
      const value=await read();
      if(!current||disposed||stamp!==token)return;
      if(!isAvailable()){pause('unavailable');return;}
      if(accept(value)!==true)fail('Read-only view rejected');
      // Private V2 readers expose revisions; public viewers do not.
      if(Number.isSafeInteger(value?.revision)){
        if(value.revision<0||(priorRevision!==null&&value.revision<priorRevision))
          fail('Authoritative revision regressed');
        priorRevision=value.revision;
      }
      present(value);successes++;
      if(!current||stamp!==token)return;
      timeout=setTimer(()=>{timeout=null;void refresh();},intervalMs);
    }catch{
      if(current&&stamp===token){failures++;pause('denied');}
    }finally{
      if(stamp===token)inFlight=false;
    }
  }
  function start(){
    if(disposed)fail('Read-only supervisor disposed');
    if(current)return false; // No overlapping timer/read loops.
    if(!isAvailable()){pause('unavailable');return false;}
    token++;priorRevision=null;current=true;
    void refresh();return true;
  }
  return Object.freeze({
    start,pause,dispose(){disposed=true;return pause('disposed');},
    get running(){return current;},
    get stats(){return Object.freeze({successes,failures,running:current,readOnly:true});},
    // No exposed submitScore, mutation or authority-resume method.
  });
}
