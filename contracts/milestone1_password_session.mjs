/** FFTT Milestone 1 — game-day staff session over email/password (SYNTHETIC-ONLY CANDIDATE).
 *
 * Lifecycle in one paragraph: a short-lived access token lives ONLY in memory; a rotating refresh token
 * renews it and (only if the person opts in AND the build allows it) is mirrored into a tab-scoped vault.
 * Every private read first proves identity (/user pinned to the signing-in account) and the CURRENT
 * event-scoped role, so a revoked grant stops the very next read even though the access token is still
 * valid. A session also ends by clock: an absolute cap and an idle cap (automatic reads are not activity),
 * and a clock that moves backwards counts as expired. Backgrounding or going offline SUSPENDS: views and
 * gate authority are dropped at once, tokens are kept in memory and nothing is read until resume()
 * re-proves identity and role. A revoked refresh token, identity change or role change ends the session
 * for good. A network or rate-limit failure never signs anyone out and never causes a retry loop.
 *
 * There are NO timers, NO automatic retries and NO score, publication or account-creation path here.
 * Passwords are never stored; they exist only as the argument of one sign-in call.
 */
import {createMilestone1ConnectedDesk} from './milestone1_connected_desk.mjs';
import {createMilestone1StaffAccessGate} from './milestone1_staff_access_gate.mjs';
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
import {StaffSignInError,normalizeStaffEmail} from './milestone1_password_transport.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNAP=new Set(['event_id','revision','generation','lifecycle','submission_id','decision']);
const fail=(kind,extra)=>{throw new StaffSignInError(kind,extra);};
const kindOf=e=>e instanceof StaffSignInError?e.kind:'denied';
const within=(x,lo,hi)=>Number.isSafeInteger(x)&&x>=lo&&x<=hi;
export function createMilestone1PasswordStaffSession({
 transport,isOnline,now=()=>Date.now(),vault=null,allowTabPersistence=false,
 refreshBeforeMs=120_000,idleTimeoutMs=2*3600_000,maxSessionMs=14*3600_000,
 maxFailures=5,cooldownBaseMs=30_000,cooldownMaxMs=900_000,
}={}){
 if(['signInWithPassword','refresh','signOut','readIdentity','readRole','readSnapshot','readMatchdesk']
    .some(k=>typeof transport?.[k]!=='function')||typeof isOnline!=='function'||typeof now!=='function'
   ||vault!==null&&['read','write','clear'].some(k=>typeof vault?.[k]!=='function')
   ||typeof allowTabPersistence!=='boolean'
   ||!within(refreshBeforeMs,10_000,600_000)||!within(idleTimeoutMs,60_000,12*3600_000)
   ||!within(maxSessionMs,idleTimeoutMs,24*3600_000)||!within(maxFailures,3,10)
   ||!within(cooldownBaseMs,1_000,300_000)||!within(cooldownMaxMs,cooldownBaseMs,3600_000))
  throw new AuthorityGateError('Invalid staff session configuration');
 let st=null,controller=null,epoch=0,sid=0,suspendedAt=null,busy=false,reading=false,refreshing=null;
 let failures=0,cooldownUntil=0,lastPersistedAt=0;
 const usable=()=>st!==null&&st.accessToken!==null&&suspendedAt===null&&now()<st.accessExpiresAt&&isOnline();
 const gate=createMilestone1StaffAccessGate({
  getAccessToken:async()=>{if(st===null||st.accessToken===null||!isOnline())fail('network');return st.accessToken;},
  readIdentity:({token})=>transport.readIdentity({token}),
  readRole:({token,eventId})=>transport.readRole({token,eventId}),
  isOnline,now,
 });
 /** Ends the session locally and erases every stored copy. Server revocation is separate. */
 function endLocal(){
  epoch++;sid++;st=null;suspendedAt=null;refreshing=null;
  controller?.signOut();controller=null;gate.signOut();
  try{vault?.clear();}catch{/* nothing stored */}
 }
 function persist(){
  if(vault===null||st===null||!st.persist||st.role===null)return;
  const ok=vault.write({v:1,refreshToken:st.refreshToken,userId:st.userId,eventId:st.eventId,
   role:st.role,startedAt:st.startedAt,lastActiveAt:st.lastActiveAt});
  if(!ok)st.persist=false; // storage refused: the session simply stays memory-only
  lastPersistedAt=now();
 }
 const limitsExceeded=()=>{
  if(st===null)return true;
  const t=now();
  if(t<st.startedAt||t<st.lastActiveAt)return true; // clock moved backwards: cannot prove freshness
  return t-st.startedAt>maxSessionMs||t-st.lastActiveAt>idleTimeoutMs;
 };
 const enforceLimits=()=>{if(limitsExceeded()){endLocal();fail('expired');}};
 const normalizeSnapshot=(raw,eventId)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==SNAP.size
    ||Object.keys(raw).some(k=>!SNAP.has(k))||raw.event_id!==eventId||raw.lifecycle!=='active'
    ||raw.submission_id!==null||raw.decision!==null
    ||!Number.isSafeInteger(raw.revision)||raw.revision<0
    ||!Number.isSafeInteger(raw.generation)||raw.generation<0)fail('unavailable');
  return Object.freeze({eventId,revision:raw.revision,generation:raw.generation,
   status:'unknown',cloudWritesEnabled:false});
 };
 const readOnlyDesk=eventId=>createMilestone1ConnectedDesk({
  readRole:({eventId:e})=>transport.readRole({eventId:e,token:st.accessToken}),
  readMatchdesk:({eventId:e})=>transport.readMatchdesk({eventId:e,token:st.accessToken}),
  readSnapshot:async({eventId:e})=>normalizeSnapshot(
   await transport.readSnapshot({eventId:e,token:st.accessToken}),e),
  isAuthenticated:usable,
 });
 /** Renew the access token if it is close to expiry. Single-flight; the rotated refresh token is
  * stored the moment it arrives (a lost rotation would orphan the session). Returns true if renewed. */
 async function ensureFresh(){
  enforceLimits();
  if(st.accessToken!==null&&st.accessExpiresAt-now()>refreshBeforeMs)return false;
  if(refreshing!==null)return refreshing;
  const mySid=sid;
  const p=(async()=>{
   await null; // always asynchronous so `refreshing` is assigned before the first finally
   try{
    if(!isOnline())fail('network');
    const r=await transport.refresh({refreshToken:st.refreshToken});
    if(mySid!==sid||st===null)fail('revoked'); // signed out while renewing: drop the orphan
    if(r.userId!==st.userId){endLocal();fail('revoked');} // never accept a different identity
    st.accessToken=r.accessToken;st.accessExpiresAt=now()+r.expiresInMs;st.refreshToken=r.refreshToken;
    persist();
    return true;
   }catch(e){
    if(mySid===sid&&kindOf(e)==='invalid-refresh'){endLocal();fail('revoked');}
    throw e instanceof StaffSignInError?e:new StaffSignInError('unavailable');
   }finally{if(mySid===sid)refreshing=null;}
  })();
  refreshing=p;
  return p;
 }
 /** Fresh identity + role proof against the CURRENT access token; rebuilds the read-only desk. */
 async function reverify(op){
  const proof=await gate.verify({eventId:st.eventId,expiresAt:st.accessExpiresAt,expectedUserId:st.userId});
  if(op!==epoch||st===null)fail('locked');
  if(st.role!==null&&proof.role!==st.role){endLocal();fail('revoked');} // any role change = new sign-in
  st.role=proof.role;
  controller=readOnlyDesk(st.eventId);
 }
 /** Classifies a failure of the CURRENT operation; only definitive ones end the session. */
 async function settle(e,op,depth=0){
  // definitive outcomes already ended the session (which advanced the epoch): never mask them
  if(e instanceof StaffSignInError&&(e.kind==='revoked'||e.kind==='expired'))throw e;
  if(op!==epoch)fail('locked'); // a newer operation (suspend, sign-out) owns the state
  const kind=kindOf(e);
  if(kind==='access-rejected'){
   // The server no longer accepts this access token. Ask ONCE why: a dead session resolves to
   // `revoked`; a healthy one is renewed and re-proved. No loop: a second rejection just reports.
   if(st===null||depth>=1)fail('access-rejected');
   st.accessExpiresAt=0;
   try{if(await ensureFresh())await reverify(op);}catch(e2){return settle(e2,op,depth+1);}
   fail('access-rejected');
  }
  if(['network','unavailable','rate-limited','locked','busy'].includes(kind)){
   if(e instanceof StaffSignInError)throw e;
   fail('unavailable');
  }
  // revoked / expired already ended the session; denied or any gate refusal: role or identity changed
  if(st!==null)endLocal();
  fail('revoked');
 }
 async function adopt(resp,{eventId,keepSignedIn=false}={}){
  if(!UUID.test(eventId||''))fail('invalid-input');
  endLocal();
  const op=++epoch,mine=++sid,t=now();
  st={refreshToken:resp.refreshToken,accessToken:resp.accessToken,accessExpiresAt:t+resp.expiresInMs,
   userId:resp.userId,eventId,role:null,startedAt:t,lastActiveAt:t,persist:false};
  const token=resp.accessToken;
  try{
   if(!isOnline())fail('network');
   const who=await transport.readIdentity({token});
   if(who.id!==resp.userId)fail('denied');
   const proof=await gate.verify({eventId,expiresAt:st.accessExpiresAt,expectedUserId:resp.userId});
   if(op!==epoch||mine!==sid||st===null)fail('locked');
   st.role=proof.role;controller=readOnlyDesk(eventId);
   st.persist=keepSignedIn===true&&allowTabPersistence&&vault!==null;
   persist();
   return Object.freeze({role:proof.role,persisted:st.persist,scoreWritesEnabled:false});
  }catch(e){
   const kind=kindOf(e),current=mine===sid;
   if(current)endLocal();
   // an authenticated account with no role must not leave a live server session behind
   if(current)try{await transport.signOut({token,scope:'local'});}catch{/* best effort */}
   if(['network','unavailable','rate-limited'].includes(kind)&&e instanceof StaffSignInError)throw e;
   fail(kind==='locked'?'locked':'not-authorized');
  }
 }

 async function signOutImpl({global=false}={}){
  const had=st!==null,token=st?.accessToken??null,expired=st===null||st.accessExpiresAt<=now();
  const rt=st?.refreshToken??null;
  endLocal();
  if(!had)return Object.freeze({serverRevoked:false});
  try{
   let use=token!==null&&!expired?token:null;
   if(use===null&&rt!==null&&isOnline())use=(await transport.refresh({refreshToken:rt})).accessToken;
   if(use!==null&&isOnline()){
    await transport.signOut({token:use,scope:global?'global':'local'});
    return Object.freeze({serverRevoked:true});
   }
  }catch{/* local sign-out already happened */}
  return Object.freeze({serverRevoked:false});
 }
 return Object.freeze({
  /** Password sign-in for an EXISTING authorized account. Never registers. */
  async signIn({email,password,eventId,keepSignedIn=false}={}){
   if(busy)fail('busy');
   const e=normalizeStaffEmail(email);
   if(typeof password!=='string'||password.length<1||password.length>128||!UUID.test(eventId||''))fail('invalid-input');
   const t=now();
   if(t<cooldownUntil)fail('cooldown',{retryAfterMs:cooldownUntil-t}); // no request is sent
   if(!isOnline())fail('network');
   busy=true;
   try{
    // replacing a live session: revoke the old one on the server too, never orphan it
    if(st!==null)await signOutImpl({global:false});
    endLocal();
    let resp;
    try{resp=await transport.signInWithPassword({email:e,password});}
    catch(err){
     const kind=kindOf(err);
     if(kind==='invalid-credentials'){
      failures++;
      if(failures>=maxFailures)cooldownUntil=now()+Math.min(cooldownMaxMs,cooldownBaseMs*2**(failures-maxFailures));
     }else if(kind==='rate-limited'){
      cooldownUntil=Math.max(cooldownUntil,now()+Math.min(cooldownMaxMs,err.retryAfterMs??60_000));
     }
     throw err instanceof StaffSignInError?err:new StaffSignInError('unavailable');
    }
    failures=0;cooldownUntil=0;
    return await adopt(resp,{eventId,keepSignedIn});
   }finally{busy=false;}
  },
  /** Used by the optional email-code recovery; receives an already validated session. */
  async adoptVerifiedSession(resp,options){
   if(busy)fail('busy');
   busy=true;
   try{return await adopt(resp,options);}finally{busy=false;}
  },
  /** Renew after a reload or a discarded mobile tab, from the opt-in tab vault. */
  async restore(){
   if(!allowTabPersistence||vault===null)fail('expired');
   if(busy)fail('busy');
   if(st!==null&&st.accessToken!==null)return Object.freeze({role:st.role,scoreWritesEnabled:false});
   if(st===null){
    const e=vault.read();
    if(e===null)fail('expired');
    const t=now();
    if(t<e.startedAt||t<e.lastActiveAt||t-e.startedAt>maxSessionMs||t-e.lastActiveAt>idleTimeoutMs){
     vault.clear();fail('expired');
    }
    sid++;
    st={refreshToken:e.refreshToken,accessToken:null,accessExpiresAt:0,userId:e.userId,eventId:e.eventId,
     role:e.role,startedAt:e.startedAt,lastActiveAt:e.lastActiveAt,persist:true};
   }
   busy=true;
   const op=++epoch;
   try{
    await ensureFresh();
    await reverify(op);
    suspendedAt=null;
    return Object.freeze({role:st.role,scoreWritesEnabled:false});
   }catch(e){await settle(e,op);}
   finally{busy=false;}
  },
  /** One private read at the current authoritative revision. Automatic reads are NOT user activity. */
  async readDesk(){
   if(st===null||st.accessToken===null)fail('expired');
   enforceLimits();
   if(suspendedAt!==null||controller===null)fail('locked');
   // One verification at a time: overlapping proofs would invalidate each other inside the gate.
   if(busy||reading)fail('busy');
   if(!isOnline())fail('network');
   const op=epoch;
   reading=true;
   try{
    if(await ensureFresh())await reverify(op);
    if(op!==epoch||controller===null)fail('locked');
    const view=await gate.withFreshRole(st.eventId,async()=>controller.refresh(st.eventId));
    if(op!==epoch)fail('locked');
    if(view.status!=='ready'||view.authoritativeForScoring!==false)fail('unavailable');
    return view;
   }catch(e){await settle(e,op);}
   finally{reading=false;}
  },
  /** The person did something (tap, key): extends the idle clock. */
  touch(){
   if(st===null||suspendedAt!==null)return;
   const t=now();
   if(t<st.lastActiveAt)return;
   st.lastActiveAt=t;
   if(st.persist&&t-lastPersistedAt>30_000)persist();
  },
  /** Backgrounded or offline: drop all views and gate authority NOW; keep tokens in memory only. */
  suspend(){
   if(st===null)return Object.freeze({suspended:false});
   epoch++;controller?.signOut();controller=null;gate.signOut();
   suspendedAt=suspendedAt??now();
   return Object.freeze({suspended:true});
  },
  async resume(){
   if(st===null)fail('expired');
   enforceLimits();
   if(suspendedAt===null&&controller!==null)return Object.freeze({role:st.role,scoreWritesEnabled:false});
   if(busy)fail('busy');
   if(!isOnline())fail('network');
   busy=true;
   const op=++epoch;
   try{
    await ensureFresh();
    await reverify(op);
    suspendedAt=null;
    return Object.freeze({role:st.role,scoreWritesEnabled:false});
   }catch(e){await settle(e,op);}
   finally{busy=false;}
  },
  /** Ends the session on this device at once; then asks the server to revoke it (best effort). */
  signOut:signOutImpl,
  /** Forget everything locally without contacting the server (e.g. the person closed the app). */
  forget(){endLocal();},
  get status(){
   const t=now();
   return Object.freeze({
    authenticated:st!==null&&st.role!==null&&st.accessToken!==null&&suspendedAt===null&&!limitsExceeded(),
    suspended:suspendedAt!==null,
    canRead:st!==null&&st.role!==null&&usable()&&controller!==null&&!limitsExceeded(),
    role:st?.role??null,eventScoped:st!==null,persisted:st?.persist===true,
    sessionRemainingMs:st===null?0:Math.max(0,maxSessionMs-(t-st.startedAt)),
    idleRemainingMs:st===null?0:Math.max(0,idleTimeoutMs-(t-st.lastActiveAt)),
    cooldownRemainingMs:Math.max(0,cooldownUntil-t),
    scoreWritesEnabled:false,noAutomaticRetry:true,
   });
  },
 });
}
