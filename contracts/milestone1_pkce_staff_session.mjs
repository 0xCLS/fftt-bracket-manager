/** M1 synthetic-only PKCE volunteer browser session model.
 * Uses the actual /otp -> PKCE /token -> /user -> event-role -> two V2
 * snapshot reads -> private Match Desk sequence. No score, publication,
 * persistent bearer/refresh token or automatic network retry.
 */
import {createMilestone1ConnectedDesk} from './milestone1_connected_desk.mjs';
import {createMilestone1StaffAccessGate} from './milestone1_staff_access_gate.mjs';
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
const invalid=()=>{throw new AuthorityGateError('Staff login or signed read unavailable')};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNAP=new Set(['event_id','revision','generation','lifecycle','submission_id','decision']);
export function createMilestone1PkceStaffSession({
 pkce,transport,redirectUri,isOnline,now=()=>Date.now(),
 // 0 (default): hiding/pausing ends the session. >0 enables suspend()/resume():
 // memory-only token kept for at most this long, never usable without re-proof.
 backgroundGraceMs=0,
}={}){
 if(typeof pkce?.begin!=='function'||typeof pkce?.complete!=='function'
   ||typeof pkce?.cancel!=='function'
   ||['requestExistingUserLink','exchangeCode','readIdentity','readRole',
      'readSnapshot','readMatchdesk'].some(k=>typeof transport?.[k]!=='function')
   ||typeof redirectUri!=='string'||typeof isOnline!=='function'||typeof now!=='function'
   ||!Number.isSafeInteger(backgroundGraceMs)||backgroundGraceMs<0
   ||backgroundGraceMs>600000)invalid();
 let token=null,expires=0,scope=null,controller=null,stamp=0;
 let userId=null,lastRole=null,suspendedAt=null;
 const tokenFresh=()=>token!==null&&now()<expires;
 const sessionAlive=()=>tokenFresh()&&isOnline()&&suspendedAt===null;
 const gate=createMilestone1StaffAccessGate({
   getAccessToken:async()=>{if(!tokenFresh()||!isOnline())invalid();return token},
   readIdentity:({token:jwt})=>transport.readIdentity({token:jwt}),
   readRole:({token:jwt,eventId})=>transport.readRole({token:jwt,eventId}),
   isOnline,now,
 });
 const clear=()=>{
   stamp++;token=null;expires=0;scope=null;controller?.signOut();
   controller=null;gate.signOut();userId=null;lastRole=null;suspendedAt=null;
 };
 const normalizeSnapshot=(raw,eventId)=>{
   if(!raw||typeof raw!=='object'||Array.isArray(raw)
     ||Object.keys(raw).length!==SNAP.size
     ||Object.keys(raw).some(k=>!SNAP.has(k))
     ||raw.event_id!==eventId||raw.lifecycle!=='active'
     ||raw.submission_id!==null||raw.decision!==null
     ||!Number.isSafeInteger(raw.revision)||raw.revision<0
     ||!Number.isSafeInteger(raw.generation)||raw.generation<0)invalid();
   return Object.freeze({eventId,revision:raw.revision,generation:raw.generation,
     status:'unknown',cloudWritesEnabled:false});
 };
 const readOnlyDesk=(eventId)=>{
   return createMilestone1ConnectedDesk({
     readRole:({eventId})=>transport.readRole({eventId,token}),
     readMatchdesk:({eventId})=>transport.readMatchdesk({eventId,token}),
     readSnapshot:async({eventId})=>normalizeSnapshot(
       await transport.readSnapshot({eventId,token}),eventId),
     isAuthenticated:sessionAlive,
   });
 };
 return Object.freeze({
   async begin(email){
     clear();pkce.cancel();
     if(!isOnline())invalid();
     const op=++stamp;
     const params=await pkce.begin();
     try{
       await transport.requestExistingUserLink({email,redirectUri,
         state:params.state,codeChallenge:params.codeChallenge});
       if(op!==stamp)invalid();
       return Object.freeze({linkRequested:true,existingAccountOnly:true});
     }catch{pkce.cancel();clear();invalid()}
   },
   async complete(callbackUrl,{eventId}={}){
     clear();
     if(!UUID.test(eventId||'')||!isOnline())invalid();
     const op=++stamp;
     let verifiedId=null;
     try{
       const session=await pkce.complete(callbackUrl,{
         exchange:({authCode,codeVerifier})=>transport.exchangeCode({authCode,codeVerifier}),
         verifyIdentity:async({accessToken})=>{
           const user=await transport.readIdentity({token:accessToken});
           verifiedId=user.id;
           return {verified:true,userId:user.id};
         },
       });
       if(op!==stamp||!isOnline())invalid();
       token=session.accessTokenForMemoryOnly;
       expires=session.expiresAt;scope=eventId;
       const proof=await gate.verify({eventId,expiresAt:expires,expectedUserId:verifiedId});
       if(op!==stamp)invalid();
       userId=verifiedId;lastRole=proof.role;
       controller=readOnlyDesk(eventId);
       return Object.freeze({role:proof.role,authorized:true,scoreWritesEnabled:false});
     }catch{clear();invalid()}
   },
   async readDesk(){
     if(!sessionAlive()||scope===null||!controller){clear();invalid()}
     const op=stamp;
     try{
       const view=await gate.withFreshRole(scope,async()=>controller.refresh(scope));
       if(op!==stamp||view.status!=='ready'||view.authoritativeForScoring!==false)invalid();
       return view;
     }catch{
       // A newer operation (suspend, pause, sign-out) already owns the state; only a
       // failure of the CURRENT operation may tear the session down.
       if(op===stamp)clear();
       invalid();
     }
   },
   signOut(){pkce.cancel();clear()},
   pause(){clear()},
   /** Backgrounded/hidden client: drop all private authority and views NOW.
    * The memory-only token survives only if a grace period was configured and
    * is unusable until resume() independently re-proves identity and role.
    */
   suspend(){
     if(backgroundGraceMs===0||!tokenFresh()||scope===null||userId===null){
       clear();return Object.freeze({suspended:false});
     }
     stamp++;controller?.signOut();controller=null;gate.signOut();
     // Grace is measured from the FIRST suspension; repeated hide events must not extend it.
     suspendedAt=suspendedAt??now();
     return Object.freeze({suspended:true});
   },
   async resume(){
     if(suspendedAt===null||!tokenFresh()||scope===null||userId===null
       ||now()-suspendedAt>backgroundGraceMs||!isOnline()){clear();invalid()}
     const op=++stamp,eventId=scope;
     try{
       const proof=await gate.verify({eventId,expiresAt:expires,expectedUserId:userId});
       // Any change of role (even an upgrade) requires a brand-new sign-in.
       if(op!==stamp||proof.role!==lastRole)invalid();
       suspendedAt=null;controller=readOnlyDesk(eventId);
       return Object.freeze({role:proof.role,authorized:true,scoreWritesEnabled:false});
     }catch{
       // Re-suspended or paused mid-resume: leave that newer state intact.
       if(op===stamp)clear();
       invalid();
     }
   },
   get status(){return Object.freeze({authenticated:sessionAlive()&&gate.status.authorized,
     role:gate.status.role,eventScoped:!!scope,scoreWritesEnabled:false,
     suspended:suspendedAt!==null,
     canRead:sessionAlive()&&gate.status.authorized,noAutomaticRetry:true});},
 });
}
