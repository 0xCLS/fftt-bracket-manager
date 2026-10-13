/** C8 isolated default Magic Link implicit-flow adapter; no scores or private tokens in browser storage. */
import {C3_HOST} from "./phase1c_c3_readonly_supabase_transport.mjs";
const KEY_RE=/^sb_publishable_[A-Za-z0-9_-]{8,}$/;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const EMAIL=/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
export const C8_REDIRECT="http://localhost:3000/rehearsals/c8/index.html";
// Fixed categories only: never propagate Supabase response bodies, headers or URL values.
export class C8RequestFailure extends Error {
 constructor(category){super(category);this.name="C8RequestFailure";this.category=category;}
}
export function safeRequestCategory(status) {
 if(status===429)return "rate-limited (HTTP 429)";
 if(status===400)return "invalid request (HTTP 400)";
 if(status===401||status===403)return "authentication denied (HTTP "+status+")";
 if(status===422)return "request rejected (HTTP 422)";
 if(status>=500&&status<=599)return "service unavailable (HTTP 5xx)";
 if(status>=300&&status<=399)return "unexpected redirect (HTTP 3xx)";
 return "request failed (HTTP "+(Number.isInteger(status)&&status>=100&&status<=599?status:"unknown")+")";
}
export class C8MagicLinkAuth {
 #fetch;#key;#session=null;#pending=null;#busy=false;#now;#callbackStatus="no-callback";
 constructor({publishableKey,fetchImpl,now=()=>Date.now()}) {
  if(!KEY_RE.test(publishableKey)||typeof fetchImpl!=="function")throw Error("Invalid public authentication configuration");
  this.#key=publishableKey;this.#fetch=fetchImpl;this.#now=now;
 }
 get status(){return {authenticated:!!this.#session&&this.#now()<this.#session.expires,busy:this.#busy,hasCallback:!!this.#pending,callbackStatus:this.#callbackStatus};}
 consumeLocation(loc,history){
  // Erase URL fragment BEFORE any asynchronous operation, network read or UI rendering.
  const hash=loc.hash||"";const search=loc.search||"";
  history.replaceState(null,"",loc.pathname);
  this.#pending=null;this.#session=null;
  this.#callbackStatus="no-callback";
  if(search){this.#callbackStatus="query-style-callback";return false;}
  if(!hash)return false;
  if(hash.length>16000||!hash.startsWith("#")){this.#callbackStatus="invalid-fragment";return false;}
  const p=new URLSearchParams(hash.slice(1));
  // Only expose recognized non-sensitive error categories, never raw descriptions or callback values.
  if(p.has("error")||p.has("error_code")){
   const c=p.get("error_code")||"";
   this.#callbackStatus=["otp_expired","access_denied","otp_disabled","over_email_send_rate_limit","invalid_request"].includes(c)?
     "supabase-error-"+c:"supabase-error-other";
   return false;
  }
  // Supabase may append non-authoritative metadata. Never trust, store, display,
  // forward or act upon those values. The bearer token must still pass /auth/v1/user.
  if([...p.keys()].length>20){this.#callbackStatus="excessive-fragment-fields";return false;}
  const mandatory=["access_token","token_type","expires_in"];
  if(mandatory.some(k=>p.getAll(k).length!==1)){this.#callbackStatus="invalid-core-fragment-fields";return false;}
  const token=p.get("access_token"),kind=p.get("type"),lifetime=Number(p.get("expires_in"));
  if(p.getAll("access_token").length!==1||!JWT.test(token||"")||token.length>10000){
   this.#callbackStatus="missing-or-invalid-access-token";return false;
  }
  if(kind && kind!=="magiclink" && kind!=="email"){this.#callbackStatus="unexpected-auth-type";return false;}
  if((p.get("token_type")||"").toLowerCase()!=="bearer"){this.#callbackStatus="unexpected-token-type";return false;}
  if(!Number.isSafeInteger(lifetime)||lifetime<60||lifetime>7200){this.#callbackStatus="invalid-session-lifetime";return false;}
  this.#callbackStatus="callback-ready";
  this.#pending={token,expires:this.#now()+lifetime*1000};
  return true;
 }
 async requestLink(email){
  if(this.#busy||this.#session||this.#pending)throw Error("Finish or restart existing authentication first");
  if(typeof email!=="string"||!EMAIL.test(email.trim())||email.length>254)throw Error("Invalid email");
  this.#busy=true;
  try {
   const url=C3_HOST+"/auth/v1/otp?redirect_to="+encodeURIComponent(C8_REDIRECT);
   let res;
   try{
    res=await this.#fetch(url,{method:"POST",redirect:"error",credentials:"omit",cache:"no-store",
     headers:{apikey:this.#key,Accept:"application/json","Content-Type":"application/json"},
     body:JSON.stringify({email:email.trim().toLowerCase(),create_user:false})});
   }catch{throw new C8RequestFailure("network or browser request failure");}
   if(res?.status!==200)throw new C8RequestFailure(safeRequestCategory(res?.status));
   return true;
  }finally{this.#busy=false;}
 }
 async verifyReturningEmail(email){
  if(this.#busy||!this.#pending)throw Error("No callback to verify");
  if(typeof email!=="string"||!EMAIL.test(email.trim()))throw Error("Invalid email");
  this.#busy=true;
  const candidate=this.#pending;this.#pending=null;
  try {
   if(this.#now()>=candidate.expires)throw Error("Callback expired");
   const res=await this.#fetch(C3_HOST+"/auth/v1/user",{method:"GET",redirect:"error",cache:"no-store",credentials:"omit",
    headers:{apikey:this.#key,Accept:"application/json",Authorization:"Bearer "+candidate.token}});
   if(res?.status!==200)throw Error("Signed account validation denied");
   const user=await res.json();
   if(typeof user?.id!=="string"||!(/^[0-9a-f-]{36}$/i).test(user.id)||
    typeof user?.email!=="string"||user.email.toLowerCase()!==email.trim().toLowerCase())throw Error("Wrong account");
   if(this.#now()>=candidate.expires)throw Error("Expired");
   this.#session=candidate;return true;
  }catch(error){this.#session=null;throw error;}finally{this.#busy=false;}
 }
 accessToken(){
  if(!this.status.authenticated){this.end();throw Error("Session expired or not verified");}
  return this.#session.token;
 }
 end(){this.#session=null;this.#pending=null;}
}
