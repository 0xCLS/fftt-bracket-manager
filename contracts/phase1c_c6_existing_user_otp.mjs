/**
 * Phase 1C C6 — narrow existing-user email-code sign-in, draft local rehearsal.
 *
 * ONLY /auth/v1/otp (explicitly user-requested, create_user:false),
 * /auth/v1/verify (user-entered 6 digits), /auth/v1/user (identity validation).
 * Never store tokens in localStorage, sessionStorage, cookie, URL or log.
 * Sessions are memory-only, expire, cannot refresh and cannot authorize writes.
 * The development Supabase project's email template MUST deliver {{ .Token }}.
 */
import {AuthorityGateError} from "./phase1c_disconnect_reference.mjs";
import {C3_HOST} from "./phase1c_c3_readonly_supabase_transport.mjs";

const PATHS=Object.freeze({
  otp:"/auth/v1/otp",
  verify:"/auth/v1/verify",
  user:"/auth/v1/user",
});
const EMAIL=/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
function requireSafe(x,reason) {
  if(!x) throw new AuthorityGateError(reason);
}
export class C6ExistingUserOtp {
  #fetch; #key; #now; #email=null; #session=null; #inFlight=false; #epoch=0;
  constructor({projectUrl=C3_HOST,publishableKey,fetchImpl,now=()=>Date.now()}={}){
    requireSafe(projectUrl===C3_HOST,"Only the synthetic development Auth host is supported");
    requireSafe(typeof publishableKey==="string"
      && publishableKey.startsWith("sb_publishable_")
      && !/\s/.test(publishableKey) && publishableKey.length<512,
      "Only a public Supabase publishable key is allowed");
    requireSafe(typeof fetchImpl==="function" && typeof now==="function",
      "Inject browser fetch and clock; no automatic network");
    this.#fetch=fetchImpl;this.#key=publishableKey;this.#now=now;
  }

  get status(){
    // Identity and JWT intentionally excluded from public status.
    return Object.freeze({
      state:this.#session&&this.#validSession()?"signed-in":
        this.#email?"awaiting-code":"signed-out",
      authenticated:Boolean(this.#session&&this.#validSession()),
      busy:this.#inFlight,
    });
  }

  #validSession(){
    return this.#session!==null&&this.#now()<this.#session.expiresAt;
  }
  #start(){
    requireSafe(!this.#inFlight,"Another authentication request is pending");
    this.#inFlight=true;
  }
  async #request(kind,body=null,bearer=null){
    const url=C3_HOST+PATHS[kind];
    const headers={
      apikey:this.#key,Accept:"application/json",
      ...(body!==null?{"Content-Type":"application/json"}:{}),
      ...(bearer?{Authorization:"Bearer "+bearer}:{}),
    };
    let result;
    try{
      result=await this.#fetch(url,{
        method:kind==="user"?"GET":"POST",
        redirect:"error",cache:"no-store",credentials:"omit",
        headers,...(body!==null?{body:JSON.stringify(body)}:{}),
      });
    }catch{
      throw new AuthorityGateError("Authentication service unavailable; try later");
    }
    requireSafe(result?.status===200,
      "Authentication request failed or was limited; no session established");
    try{return await result.json();}
    catch{throw new AuthorityGateError("Authentication response invalid");}
  }

  async requestCode(email){
    this.#start();
    const epoch=this.#epoch;
    try{
      requireSafe(this.#session===null,"End current session before requesting another code");
      requireSafe(typeof email==="string"&&EMAIL.test(email.trim())
        && email.trim().length<=254,"Enter a valid existing test-account email");
      const clean=email.trim().toLowerCase();
      // create_user false means real participants cannot silently self-enroll.
      await this.#request("otp",{email:clean,create_user:false});
      requireSafe(this.#epoch===epoch,"Auth attempt cancelled");
      this.#email=clean;
      return Object.freeze({requested:true});
    }catch(error){
      this.#email=null;
      throw error;
    }finally{this.#inFlight=false;}
  }

  async verifyCode(token){
    this.#start();
    const epoch=this.#epoch;
    try{
      requireSafe(!this.#session&&this.#email!==null,
        "A requested one-time code is required");
      requireSafe(typeof token==="string"&&/^\d{6}$/.test(token),
        "Enter exactly six digits, no links or JWTs");
      const response=await this.#request("verify",{
        email:this.#email,token,type:"email",
      });
      const access=response?.access_token;
      const user=response?.user;
      const lifetime=response?.expires_in;
      requireSafe(typeof access==="string"&&JWT.test(access)
        && access.length<10000,"Invalid signed session response");
      requireSafe(user?.id&&UUID.test(user.id)
        && typeof user.email==="string"
        && user.email.toLowerCase()===this.#email,
        "Signed session not tied to requested account");
      requireSafe(response?.token_type?.toLowerCase()==="bearer"
        && Number.isSafeInteger(lifetime)&&lifetime>=60&&lifetime<=7200,
        "Session lifetime/authorization invalid");
      // Validation is by the actual hosted Auth GET /user endpoint, not by
      // decoding unauthenticated JWT user metadata in browser code.
      const confirmed=await this.#request("user",null,access);
      requireSafe(this.#epoch===epoch,"Auth attempt cancelled");
      requireSafe(confirmed?.id===user.id
        && typeof confirmed.email==="string"
        && confirmed.email.toLowerCase()===this.#email,
        "Session failed independent Auth /user validation");
      const end=this.#now()+lifetime*1000;
      requireSafe(Number.isSafeInteger(end),"Invalid session expiration");
      this.#session={token:access,expiresAt:end};
      this.#email=null;
      return Object.freeze({authenticated:true});
    }catch(error){
      this.#session=null;
      // OTP challenge expires after an error; intentionally require fresh
      // user-triggered request to avoid replays and repeated guessing.
      this.#email=null;
      throw error;
    }finally{this.#inFlight=false;}
  }

  accessToken(){
    if(!this.#validSession()){
      this.#session=null;
      throw new AuthorityGateError("Session missing or expired; sign in again");
    }
    return this.#session.token;
  }

  end(){
    // This only clears the local in-memory session. The backend access token
    // remains live until expiry: true server sign-out is a later auth gate.
    this.#epoch++;
    this.#session=null;this.#email=null;
    return Object.freeze({signedOutLocally:true});
  }
}
