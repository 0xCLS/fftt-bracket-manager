/** Browser-only cryptographic PKCE primitives for the isolated M1 proposal.
 * Generates S256 challenge and high-entropy verifier/state using Web Crypto.
 * An injected per-tab session vault stores only ONE pending transaction;
 * it never stores signed JWT, refresh token, user email or private event.
 * Session storage is a risk and must be hardened/audited for production.
 */
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
const deny=()=>{throw new AuthorityGateError('Invalid PKCE browser adapter configuration');};
const VERIFIER=/^[A-Za-z0-9._~-]{43,128}$/;
const STATE=/^[A-Za-z0-9_-]{32,128}$/;
const encode=bytes=>btoa(String.fromCharCode(...bytes))
 .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const onlyEntry=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
 &&Object.keys(x).length===5
 &&['verifier','state','until','origin','path'].every(k=>Object.hasOwn(x,k))
 &&VERIFIER.test(x.verifier)&&STATE.test(x.state)
 &&Number.isSafeInteger(x.until)&&x.until>0
 &&typeof x.origin==='string'&&x.origin.length<200
 &&typeof x.path==='string'&&x.path.length<250;
export function createMilestone1BrowserPkcePrimitives({
 cryptoImpl,tabStorage,key='fftt.m1.pkce.one-pending',b64url=encode
}={}){
 if(typeof cryptoImpl?.getRandomValues!=='function'
   ||typeof cryptoImpl?.subtle?.digest!=='function'
   ||typeof tabStorage?.getItem!=='function'
   ||typeof tabStorage?.setItem!=='function'
   ||typeof tabStorage?.removeItem!=='function'
   ||typeof b64url!=='function'||key!=='fftt.m1.pkce.one-pending')deny();
 const random=n=>{const bytes=new Uint8Array(n);
  cryptoImpl.getRandomValues(bytes);return b64url(bytes);
 };
 const vault=Object.freeze({
  write:transaction=>{
   if(!onlyEntry(transaction)||tabStorage.getItem(key)!==null)deny();
   tabStorage.setItem(key,JSON.stringify(transaction));
  },
  take:()=>{
   const raw=tabStorage.getItem(key);
   // Atomic-ish consume before parse: never re-use verifier after callback.
   tabStorage.removeItem(key);
   if(raw===null)return null;
   try{const t=JSON.parse(raw);if(!onlyEntry(t))return null;return t}
   catch{return null}
  },
  clear:()=>tabStorage.removeItem(key),
  get hasPending(){return tabStorage.getItem(key)!==null},
 });
 return Object.freeze({
  createVerifier:()=>random(64),createState:()=>random(32),
  challengeFor:async verifier=>{
   if(!VERIFIER.test(verifier))deny();
   const digest=await cryptoImpl.subtle.digest(
     'SHA-256',new TextEncoder().encode(verifier));
   return b64url(new Uint8Array(digest));
  },
  vault,
 });
}
