/** FFTT Milestone 1 — email/password (and optional 6-digit email code) Supabase Auth transport.
 * SYNTHETIC-ONLY CANDIDATE. Network is disabled unless a caller explicitly passes
 * allowSyntheticAuthNetwork:true, and hosted password sign-in is NOT enabled on the project.
 * Uses only supported GoTrue endpoints: password grant, refresh_token grant, logout, current user,
 * existing-user-only email OTP (create_user:false) and OTP verify, plus the three audited read RPCs.
 * No sign-up, no recovery link, no admin API, no privileged key, no redirect URL, no score or publish path.
 * Failures are CLASSIFIED (never a raw backend body) so callers can tell a revoked credential from a
 * network blip: wrong credentials and unknown accounts are deliberately indistinguishable.
 */
import {C3_HOST} from './phase1c_c3_readonly_supabase_transport.mjs';
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
const JWT=/^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const REFRESH=/^[A-Za-z0-9._~+/=-]{8,512}$/;
const CODE=/^\d{6}$/;
const MAX_PASSWORD=128;
export const SIGN_IN_ERROR_KINDS=Object.freeze([
 'invalid-input','invalid-credentials','invalid-refresh','invalid-code','rate-limited','cooldown',
 'network','unavailable','access-rejected','denied','not-authorized','expired','revoked','busy','locked',
]);
/** Carries only a machine-readable kind; never a server message, token or address. */
export class StaffSignInError extends AuthorityGateError{
 constructor(kind,{retryAfterMs=null}={}){
  super('Staff sign-in unavailable');
  this.name='StaffSignInError';
  this.kind=SIGN_IN_ERROR_KINDS.includes(kind)?kind:'unavailable';
  this.retryAfterMs=Number.isSafeInteger(retryAfterMs)&&retryAfterMs>0?retryAfterMs:null;
 }
}
const fail=(kind,extra)=>{throw new StaffSignInError(kind,extra);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const ALLOWED=new Set([
 '/auth/v1/token?grant_type=password','/auth/v1/token?grant_type=refresh_token',
 '/auth/v1/logout?scope=local','/auth/v1/logout?scope=global','/auth/v1/user',
 '/auth/v1/otp','/auth/v1/verify',
 '/rest/v1/rpc/fftt_staff_role_v1','/rest/v1/rpc/fftt_matchdesk_v1',
 '/rest/v1/rpc/fftt_score_decision_snapshot_v2',
]);
export const normalizeStaffEmail=email=>{
 if(typeof email!=='string')fail('invalid-input');
 const e=email.trim().toLowerCase();
 if(!EMAIL.test(e)||e.length>254)fail('invalid-input');
 return e;
};
function checkedSession(json){
 const ok=plain(json)&&typeof json.access_token==='string'&&JWT.test(json.access_token)
  &&json.access_token.length<=10000&&String(json.token_type).toLowerCase()==='bearer'
  &&Number.isSafeInteger(json.expires_in)&&json.expires_in>=60&&json.expires_in<=7200
  &&typeof json.refresh_token==='string'&&REFRESH.test(json.refresh_token)
  &&plain(json.user)&&typeof json.user.id==='string'&&UUID.test(json.user.id);
 if(!ok)fail('unavailable');
 // Only these four fields ever leave the transport; anything else from the server is dropped.
 return Object.freeze({accessToken:json.access_token,refreshToken:json.refresh_token,
  expiresInMs:json.expires_in*1000,userId:json.user.id});
}
function retryAfter(response){
 let raw=null;
 try{raw=response.headers?.get?.('retry-after')??null;}catch{raw=null;}
 const seconds=Number.parseInt(raw,10);
 return Number.isSafeInteger(seconds)&&seconds>=1&&seconds<=900?seconds*1000:60000;
}
export function createMilestone1PasswordSupabaseTransport({
 projectUrl=C3_HOST,publishableKey,fetchImpl,allowSyntheticAuthNetwork=false,
}={}){
 if(projectUrl!==C3_HOST||typeof publishableKey!=='string'
   ||!/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(publishableKey)
   ||publishableKey.length>512||typeof fetchImpl!=='function')fail('unavailable');
 let requests=0;
 /** `onClient4xx` names what a 4xx means for this call; 'generic' hides it entirely. */
 async function send(path,{body=null,token=null,method='POST',onClient4xx='access-rejected'}={}){
  if(allowSyntheticAuthNetwork!==true||!ALLOWED.has(path))fail('unavailable');
  const needsToken=path.startsWith('/rest/')||path==='/auth/v1/user'||path.startsWith('/auth/v1/logout');
  if(needsToken!==(token!==null))fail('unavailable');
  if(token!==null&&(typeof token!=='string'||!JWT.test(token)||token.length>10000))fail('unavailable');
  const headers={apikey:publishableKey,Accept:'application/json',
   ...(body!==null?{'Content-Type':'application/json'}:{}),
   ...(token!==null?{Authorization:'Bearer '+token}:{})};
  requests++;
  let response;
  try{
   response=await fetchImpl(projectUrl+path,{method,redirect:'error',credentials:'omit',
    cache:'no-store',referrerPolicy:'no-referrer',headers,
    ...(body!==null?{body:JSON.stringify(body)}:{})});
  }catch{fail('network');}
  const status=response?.status;
  if(status===429)fail('rate-limited',{retryAfterMs:retryAfter(response)});
  if(status===200||status===204&&path.startsWith('/auth/v1/logout')){
   if(status===204)return {};
   try{return await response.json();}catch{fail('unavailable');}
  }
  if(Number.isSafeInteger(status)&&status>=400&&status<500){
   if(onClient4xx==='generic')return null; // no account-existence signal
   if(onClient4xx==='denied-by-status')fail(status===401?'access-rejected':'denied');
   fail(onClient4xx);
  }
  fail('unavailable');
 }
 const readOne=async(path,{token,body,method='POST'})=>send(path,{token,body,method,onClient4xx:'denied-by-status'});
 return Object.freeze({
  async signInWithPassword({email,password}={}){
   const e=normalizeStaffEmail(email);
   if(typeof password!=='string'||password.length<1||password.length>MAX_PASSWORD)fail('invalid-input');
   return checkedSession(await send('/auth/v1/token?grant_type=password',
    {body:{email:e,password},onClient4xx:'invalid-credentials'}));
  },
  async refresh({refreshToken}={}){
   if(typeof refreshToken!=='string'||!REFRESH.test(refreshToken))fail('invalid-refresh');
   return checkedSession(await send('/auth/v1/token?grant_type=refresh_token',
    {body:{refresh_token:refreshToken},onClient4xx:'invalid-refresh'}));
  },
  async signOut({token,scope='local'}={}){
   if(!['local','global'].includes(scope))fail('invalid-input');
   await send('/auth/v1/logout?scope='+scope,{token,onClient4xx:'access-rejected'});
   return Object.freeze({serverRevoked:true,scope});
  },
  /** Existing accounts only. The result never reveals whether the account exists. */
  async requestEmailCode({email}={}){
   await send('/auth/v1/otp',{body:{email:normalizeStaffEmail(email),create_user:false},onClient4xx:'generic'});
   return Object.freeze({requested:true});
  },
  async verifyEmailCode({email,code}={}){
   const e=normalizeStaffEmail(email);
   if(typeof code!=='string'||!CODE.test(code))fail('invalid-input');
   return checkedSession(await send('/auth/v1/verify',
    {body:{type:'email',email:e,token:code},onClient4xx:'invalid-code'}));
  },
  async readIdentity({token}={}){
   const user=await readOne('/auth/v1/user',{token,body:null,method:'GET'});
   if(!plain(user)||!UUID.test(user.id||'')||user.is_anonymous===true)fail('denied');
   return Object.freeze({id:user.id,is_anonymous:false});
  },
  async readRole({eventId,token}={}){
   if(!UUID.test(eventId||''))fail('invalid-input');
   const role=await readOne('/rest/v1/rpc/fftt_staff_role_v1',{token,body:{p_event_id:eventId}});
   if(role!=='organizer'&&role!=='scorekeeper')fail('denied');
   return role;
  },
  async readMatchdesk({eventId,token}={}){
   if(!UUID.test(eventId||''))fail('invalid-input');
   const rows=await readOne('/rest/v1/rpc/fftt_matchdesk_v1',{token,body:{p_event_id:eventId}});
   if(!Array.isArray(rows)||rows.length>256)fail('unavailable');
   return rows;
  },
  async readSnapshot({eventId,token}={}){
   if(!UUID.test(eventId||''))fail('invalid-input');
   const snap=await readOne('/rest/v1/rpc/fftt_score_decision_snapshot_v2',
    {token,body:{p_event_id:eventId,p_submission_id:null}});
   if(!plain(snap)||snap.event_id!==eventId||snap.decision!==null)fail('unavailable');
   return snap;
  },
  getRequestCount:()=>requests,
 });
}
