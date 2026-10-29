/** FFTT Milestone 1 — provider-neutral PKCE callback guard, synthetic prototype.
 * Invoking app/SDK owns tokens; this module persists ONLY one pending PKCE verifier
 * in an injected tab-scoped vault. No session JWT, email or refresh token storage.
 * No implicit-flow URL fragments, token logs, account creation, network or writes.
 * The redirect/PKCE grant must still be tested against a configured Auth provider
 * before calling any future deployment "production-ready".
 */
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
const fail=()=>{throw new AuthorityGateError('PKCE challenge or callback invalid; restart sign-in');};
const B64URL=/^[A-Za-z0-9_-]+$/;
const VERIFIER=/^[A-Za-z0-9._~-]{43,128}$/;
const UUID_OR_STATE=/^[A-Za-z0-9_-]{32,128}$/;
export function createMilestone1PkceGuard({
 redirectUri,createVerifier,createState,challengeFor,vault,
 now=()=>Date.now(),lifetimeMs=600000,
}={}){
 let uri;
 try{uri=new URL(redirectUri)}catch{fail()}
 if(!uri||!['http:','https:'].includes(uri.protocol)||uri.username||uri.password
   ||uri.hash||uri.search||uri.port&&!((uri.hostname==='localhost'||uri.hostname==='127.0.0.1')&&uri.protocol==='http:')
   ||(uri.protocol==='http:'&&uri.hostname!=='localhost'&&uri.hostname!=='127.0.0.1')
   ||typeof createVerifier!=='function'||typeof createState!=='function'
   ||typeof challengeFor!=='function'||typeof now!=='function'
   ||!vault||typeof vault.write!=='function'||typeof vault.take!=='function'
   ||typeof vault.clear!=='function'
   ||!Number.isSafeInteger(lifetimeMs)||lifetimeMs<60000||lifetimeMs>900000)fail();
 let busy=false;
 async function begin(){
   if(busy)fail();busy=true;
   try{
     const verifier=createVerifier(),state=createState();
     if(!VERIFIER.test(verifier)||!UUID_OR_STATE.test(state))fail();
     const challenge=await challengeFor(verifier);
     if(typeof challenge!=='string'||challenge.length!==43||!B64URL.test(challenge))fail();
     vault.clear();vault.write({verifier,state,until:now()+lifetimeMs,
       origin:uri.origin,path:uri.pathname});
     // Never expose verifier to UI or a browser URL.
     return Object.freeze({state,codeChallenge:challenge,codeChallengeMethod:'s256'});
   }catch(error){vault.clear();throw error}
   finally{busy=false}
 }
 async function complete(callbackUrl,{exchange,verifyIdentity}={}){
   if(busy)fail();busy=true;
   // Consumed even on a malformed callback or failed provider exchange.
   const pending=vault.take();
   try{
     if(!pending||!VERIFIER.test(pending.verifier)||!UUID_OR_STATE.test(pending.state)
       ||now()>pending.until||typeof exchange!=='function'
       ||typeof verifyIdentity!=='function')fail();
     let target;try{target=new URL(callbackUrl)}catch{fail()}
     const params=[...target.searchParams.keys()];
     if(target.origin!==pending.origin||target.pathname!==pending.path
       ||target.hash||params.length!==2||!params.includes('code')
       ||!params.includes('state')||target.searchParams.getAll('code').length!==1
       ||target.searchParams.getAll('state').length!==1
       ||target.searchParams.get('state')!==pending.state
       ||!UUID_OR_STATE.test(target.searchParams.get('code')||''))fail();
     const session=await exchange({
       authCode:target.searchParams.get('code'),
       codeVerifier:pending.verifier,
       redirectUri:redirectUri,
     });
     const token=session?.access_token;
     if(typeof token!=='string'||token.split('.').length!==3||token.length>10000
       ||session?.token_type?.toLowerCase()!=='bearer'
       ||!Number.isSafeInteger(session?.expires_in)
       ||session.expires_in<60||session.expires_in>7200)fail();
     // SDK caller must independently validate /auth/v1/user.
     const checked=await verifyIdentity({accessToken:token});
     if(checked?.verified!==true||typeof checked.userId!=='string'
       ||!/^[0-9a-f-]{36}$/i.test(checked.userId))fail();
     return Object.freeze({identityVerified:true,needsEventRoleCheck:true,
       accessTokenForMemoryOnly:token,expiresAt:now()+session.expires_in*1000});
   }catch(error){throw error}
   finally{busy=false;vault.clear()}
 }
 return Object.freeze({begin,complete,cancel:()=>{if(busy)fail();vault.clear();}});
}
/** One-page tab vault implementation. Only a pending verifier/state is retained.
 * Caller may inject a sessionStorage-backed vault for full-page redirects;
 * never store bearer/refresh tokens and purge the transaction on completion.
 */
export function createMilestone1MemoryPkceVault(){
 let entry=null;
 return Object.freeze({
   write:v=>{if(entry!==null)fail();entry=Object.freeze({...v});},
   take:()=>{const value=entry;entry=null;return value;},
   clear:()=>{entry=null;},
   get hasPending(){return entry!==null;},
 });
}
