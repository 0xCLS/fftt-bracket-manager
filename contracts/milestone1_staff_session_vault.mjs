/** FFTT Milestone 1 — tab-scoped staff session vault (opt-in, synthetic candidate).
 * Holds ONLY what is needed to renew a session after a reload or a discarded mobile tab:
 * the rotating refresh token, the pinned user id, the event id, the verified role and two timestamps.
 * NEVER an access token, a password, an email address or a code. sessionStorage is tab-scoped: it is
 * not shared with other tabs, ends when the tab closes, and is never written by default.
 * Strict schema: anything else (tampered, truncated, extra keys, wrong types) is discarded and erased.
 * Storage failures (private mode, quota) mean "not persisted", never an exception to the caller.
 */
const KEY='fftt.m1.staff-session.tab';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFRESH=/^[A-Za-z0-9._~+/=-]{8,512}$/;
const FIELDS=Object.freeze(['v','refreshToken','userId','eventId','role','startedAt','lastActiveAt']);
const natural=x=>Number.isSafeInteger(x)&&x>0;
function valid(e){
 return e!==null&&typeof e==='object'&&!Array.isArray(e)
  &&Object.keys(e).length===FIELDS.length&&FIELDS.every(k=>Object.hasOwn(e,k))
  &&e.v===1&&typeof e.refreshToken==='string'&&REFRESH.test(e.refreshToken)
  &&typeof e.userId==='string'&&UUID.test(e.userId)&&typeof e.eventId==='string'&&UUID.test(e.eventId)
  &&['organizer','scorekeeper'].includes(e.role)&&natural(e.startedAt)&&natural(e.lastActiveAt)
  &&e.lastActiveAt>=e.startedAt;
}
export function createMilestone1StaffSessionVault({tabStorage}={}){
 if(typeof tabStorage?.getItem!=='function'||typeof tabStorage?.setItem!=='function'
   ||typeof tabStorage?.removeItem!=='function')throw new Error('Tab storage required');
 const clear=()=>{try{tabStorage.removeItem(KEY);}catch{/* nothing to erase */}};
 return Object.freeze({
  read(){
   let raw;
   try{raw=tabStorage.getItem(KEY);}catch{return null;}
   if(raw===null)return null;
   try{
    if(typeof raw!=='string'||raw.length>2000)throw new Error('size');
    const parsed=JSON.parse(raw);
    if(!valid(parsed))throw new Error('schema');
    return Object.freeze({...parsed});
   }catch{clear();return null;} // corrupt or tampered: erase, never trust
  },
  write(entry){
   if(!valid(entry))return false;
   const clean={};for(const k of FIELDS)clean[k]=entry[k];
   try{tabStorage.setItem(KEY,JSON.stringify(clean));return true;}catch{return false;}
  },
  clear,
 });
}
