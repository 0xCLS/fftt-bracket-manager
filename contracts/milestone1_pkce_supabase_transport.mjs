/** FFTT Milestone 1 — real Supabase GoTrue/PostgREST-shaped PKCE transport.
 * Synthetic development host ONLY. Network function explicitly injected.
 * No privileged key, user creation, refresh persistence, score writer,
 * publication, implicit callback, automatic retries or Auth configuration.
 * Caller must obtain separate approval before invoking against hosted Auth.
 */
import {C3_HOST} from './phase1c_c3_readonly_supabase_transport.mjs';
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
const AUTH_CODE=/^[A-Za-z0-9_-]{32,128}$/;
const CHALLENGE=/^[A-Za-z0-9_-]{43}$/;
const VERIFIER=/^[A-Za-z0-9._~-]{43,128}$/;
const JWT=/^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const deny=()=>{throw new AuthorityGateError('Synthetic authentication or event read denied; no data retained');};
export function createMilestone1PkceSupabaseTransport({
 projectUrl=C3_HOST,publishableKey,fetchImpl,
 allowSyntheticAuthNetwork=false,
}={}){
 if(projectUrl!==C3_HOST||typeof publishableKey!=='string'
   ||!/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(publishableKey)
   ||publishableKey.length>512||typeof fetchImpl!=='function')deny();
 const checkedToken=token=>{
   if(typeof token!=='string'||!JWT.test(token)||token.length>10000)deny();
   return token;
 };
 let requests=0;
 async function send(path,{body=null,token=null,method='POST',allowAuth=false}={}){
   if(allowSyntheticAuthNetwork!==true)deny();
   const bare=path.split('?')[0];
   if(path.startsWith('/auth/v1/otp?')&&!path.startsWith('/auth/v1/otp?redirect_to='))deny();
   if(bare==='/auth/v1/otp'&&!path.includes('?redirect_to='))deny();
   if(![
    '/auth/v1/otp','/auth/v1/token','/auth/v1/user',
    '/rest/v1/rpc/fftt_staff_role_v1','/rest/v1/rpc/fftt_matchdesk_v1',
    '/rest/v1/rpc/fftt_score_decision_snapshot_v2',
   ].includes(bare)&&path!=='/auth/v1/token?grant_type=pkce')deny();
   if(bare==='/auth/v1/token'&&path!=='/auth/v1/token?grant_type=pkce')deny();
   const privateRead=bare==='/auth/v1/user'||bare.startsWith('/rest/v1/rpc/');
   if(privateRead)checkedToken(token); // Fail BEFORE an unsigned private HTTP request.
   else if(token!==null)deny();
   const headers={apikey:publishableKey,Accept:'application/json',
     ...(body!==null?{'Content-Type':'application/json'}:{}),
     ...(token!==null?{Authorization:'Bearer '+checkedToken(token)}:{})};
   requests++;let response;
   try{
     response=await fetchImpl(C3_HOST+path,{method,redirect:'error',
       credentials:'omit',cache:'no-store',headers,
       ...(body!==null?{body:JSON.stringify(body)}:{})});
   }catch{deny()}
   if(response?.status!==200)deny();
   try{return await response.json()}catch{deny()}
 }
 return Object.freeze({
   async requestExistingUserLink({email,redirectUri,state,codeChallenge}={}){
     if(typeof email!=='string'||!EMAIL.test(email.trim())
       ||email.trim().length>254||!AUTH_CODE.test(state||'')
       ||!CHALLENGE.test(codeChallenge||''))deny();
     let redirect;try{redirect=new URL(redirectUri)}catch{deny()}
     if(!redirect||redirect.search||redirect.hash
       ||redirect.protocol!=='https:'&&!(redirect.protocol==='http:'&&(redirect.hostname==='localhost'||redirect.hostname==='127.0.0.1'))
       ||redirect.username||redirect.password)deny();
     redirect.searchParams.set('state',state);
     // This is *existing accounts only*. Send no notification in CI mocks.
     await send('/auth/v1/otp?redirect_to='+encodeURIComponent(redirect.toString()),{
       body:{email:email.trim().toLowerCase(),create_user:false,
         code_challenge:codeChallenge,code_challenge_method:'s256'},
       allowAuth:true,
     });
     return Object.freeze({linkRequested:true});
   },
   async exchangeCode({authCode,codeVerifier}={}){
     if(!AUTH_CODE.test(authCode||'')||!VERIFIER.test(codeVerifier||''))deny();
     return send('/auth/v1/token?grant_type=pkce',{
       body:{auth_code:authCode,code_verifier:codeVerifier},allowAuth:true,
     });
   },
   async readIdentity({token}={}){
     const user=await send('/auth/v1/user',{method:'GET',token,allowAuth:true});
     if(!UUID.test(user?.id||'')||user?.is_anonymous===true)deny();
     return Object.freeze({id:user.id,is_anonymous:false});
   },
   async readRole({eventId,token}={}){
     if(!UUID.test(eventId||''))deny();
     const role=await send('/rest/v1/rpc/fftt_staff_role_v1',{
       body:{p_event_id:eventId},token});
     if(role!=='organizer'&&role!=='scorekeeper')deny();
     return role;
   },
   async readMatchdesk({eventId,token}={}){
     if(!UUID.test(eventId||''))deny();
     const rows=await send('/rest/v1/rpc/fftt_matchdesk_v1',{
       body:{p_event_id:eventId},token});
     if(!Array.isArray(rows)||rows.length>256)deny();
     return rows;
   },
   async readSnapshot({eventId,token}={}){
     if(!UUID.test(eventId||''))deny();
     const snapshot=await send('/rest/v1/rpc/fftt_score_decision_snapshot_v2',{
       body:{p_event_id:eventId,p_submission_id:null},token});
     if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)
       ||snapshot.event_id!==eventId
       ||snapshot.decision!==null)deny();
     return snapshot;
   },
   getRequestCount:()=>requests,
 });
}