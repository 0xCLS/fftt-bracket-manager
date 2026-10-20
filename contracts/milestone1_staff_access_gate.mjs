/** Milestone 1 synthetic-only staff session authorization gate.
 * Paired with a future audited PKCE Auth SDK; independently verifies
 * current user and event-scoped role before any private read.
 * NO score API, long-lived storage, service-role, user provisioning, or
 * implicit authority from token existence. No real FFTT3 data allowed.
 */
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const deny=()=>{throw new AuthorityGateError('Signed staff session expired, changed or not authorized');};
export function createMilestone1StaffAccessGate({
 getAccessToken,readIdentity,readRole,isOnline,now=()=>Date.now()
}={}){
 if([getAccessToken,readIdentity,readRole,isOnline,now].some(f=>typeof f!=='function'))deny();
 let epoch=0,active=null;
 const drop=()=>{epoch++;active=null;};
 async function verify({eventId,expiresAt}={}){
   drop();const stamp=epoch;
   if(!UUID.test(eventId||'')||!Number.isSafeInteger(expiresAt)
     ||expiresAt<=now()||expiresAt>now()+7200*1000||!isOnline())deny();
   const token=await getAccessToken();
   if(typeof token!=='string'||!JWT.test(token)||token.length>10000)deny();
   const who=await readIdentity({token});
   if(stamp!==epoch)deny();
   if(!UUID.test(who?.id||'')||who?.is_anonymous===true)deny();
   const role=await readRole({eventId,token});
   if(stamp!==epoch)deny();
   if(!['organizer','scorekeeper'].includes(role))deny();
   if(!isOnline()||now()>=expiresAt)deny();
   active={eventId,expiresAt,userId:who.id,role};
   return Object.freeze({authorized:true,role,privateReadOnly:true,
     scoreWritesEnabled:false,requiresRoleRecheck:true});
 }
 async function withFreshRole(eventId,readAction){
   if(!active||active.eventId!==eventId||typeof readAction!=='function'
     ||!isOnline()||now()>=active.expiresAt){drop();deny();}
   const stamp=epoch,token=await getAccessToken();
   if(typeof token!=='string'||!JWT.test(token)||token.length>10000){drop();deny();}
   const user=await readIdentity({token});
   if(stamp!==epoch)deny();
   if(user?.id!==active.userId||user?.is_anonymous===true){drop();deny();}
   const role=await readRole({eventId,token});
   if(stamp!==epoch)deny();
   if(role!==active.role||!isOnline()||now()>=active.expiresAt){drop();deny();}
   let result;
   try{result=await readAction({eventId,token,role});}catch{drop();deny();}
   if(stamp!==epoch)deny();
   if(!isOnline()||now()>=active.expiresAt){drop();deny();}
   // Returned material belongs to strict existing signed reader's field allowlist.
   return result;
 }
 return Object.freeze({
  verify,withFreshRole,
  signOut:drop,pause:drop,dispose:drop,
  get status(){return Object.freeze({authorized:!!active&&isOnline()&&now()<active.expiresAt,
   role:active?.role??null,cloudScoreWritesEnabled:false,noAutomaticRetry:true});},
 });
}
