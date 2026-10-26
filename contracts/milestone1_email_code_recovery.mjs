/** FFTT Milestone 1 — OPTIONAL six-digit email code sign-in for recovery or exceptional access.
 * SYNTHETIC-ONLY CANDIDATE, deliberately separate from routine password login: it never runs unless a
 * person explicitly asks for a code. Existing accounts only (create_user:false); the answer to "send a
 * code" is identical for known and unknown addresses. Client limits are advisory (the provider enforces
 * its own): one request per cooldown, a few guesses per code, a short code lifetime, single use, and one
 * verification in flight. The verified session is handed straight to the staff session, which performs
 * the same independent identity and event-role proof as a password sign-in; the caller never sees tokens.
 * Needs the Auth email to contain the code ({{ .Token }}); that template change is NOT made here.
 */
import {StaffSignInError,normalizeStaffEmail} from './milestone1_password_transport.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE=/^\d{6}$/;
const fail=(kind,extra)=>{throw new StaffSignInError(kind,extra);};
export function createMilestone1EmailCodeRecovery({
 transport,adopt,now=()=>Date.now(),
 requestCooldownMs=60_000,maxVerifyAttempts=5,codeLifetimeMs=900_000,
}={}){
 if(typeof transport?.requestEmailCode!=='function'||typeof transport?.verifyEmailCode!=='function'
   ||typeof adopt!=='function'||typeof now!=='function'
   ||!Number.isSafeInteger(requestCooldownMs)||requestCooldownMs<30_000||requestCooldownMs>3600_000
   ||!Number.isSafeInteger(maxVerifyAttempts)||maxVerifyAttempts<1||maxVerifyAttempts>5
   ||!Number.isSafeInteger(codeLifetimeMs)||codeLifetimeMs<60_000||codeLifetimeMs>3600_000)
  throw new StaffSignInError('unavailable');
 let pending=null,cooldownUntil=0,busy=false,attempts=0;
 return Object.freeze({
  /** Always resolves to the same shape for any address; never reveals whether an account exists. */
  async request(email){
   if(busy)fail('busy');
   const e=normalizeStaffEmail(email);
   const t=now();
   if(t<cooldownUntil)fail('cooldown',{retryAfterMs:cooldownUntil-t});
   cooldownUntil=t+requestCooldownMs; // set BEFORE the call: a failure must not invite hammering
   busy=true;
   try{
    await transport.requestEmailCode({email:e});
    pending=Object.freeze({email:e,requestedAt:now()});
    attempts=0;
    return Object.freeze({requested:true,generic:true});
   }catch(err){
    if(err instanceof StaffSignInError&&err.kind==='rate-limited')
     cooldownUntil=Math.max(cooldownUntil,now()+(err.retryAfterMs??requestCooldownMs));
    throw err;
   }finally{busy=false;}
  },
  async verify({email,code,eventId,keepSignedIn=false}={}){
   if(busy)fail('busy');
   const noEvent=eventId===null||eventId===undefined||eventId==='';
   if(typeof code!=='string'||!CODE.test(code)||(!noEvent&&!UUID.test(eventId||'')))fail('invalid-input'); // no guess consumed
   const e=normalizeStaffEmail(email);
   if(pending===null||pending.email!==e)fail('expired');
   if(now()-pending.requestedAt>codeLifetimeMs){pending=null;fail('expired');}
   if(attempts>=maxVerifyAttempts){pending=null;fail('locked');}
   attempts++; // counted before the network call
   busy=true;
   let resp;
   try{resp=await transport.verifyEmailCode({email:e,code});}
   catch(err){
    if(attempts>=maxVerifyAttempts&&err instanceof StaffSignInError&&err.kind==='invalid-code'){pending=null;}
    throw err;
   }finally{busy=false;}
   pending=null; // a code is single use
   return adopt(resp,{eventId:noEvent?null:eventId,keepSignedIn});
  },
  get status(){
   const t=now();
   return Object.freeze({codeRequested:pending!==null,cooldownRemainingMs:Math.max(0,cooldownUntil-t),
    attemptsLeft:pending===null?0:Math.max(0,maxVerifyAttempts-attempts),noAutomaticRetry:true});
  },
 });
}
