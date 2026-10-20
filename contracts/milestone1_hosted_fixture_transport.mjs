/**
 * FFTT M1: explicitly approved ONE hosted synthetic event and match, 2026-10-19.
 * Existing user JWT only. No secret keys, admin endpoints, persisted tokens,
 * implicit retries, new users, fixture creation or production authorization.
 * The fixture pins below are SHA-256 of private UUIDs, never raw UUIDs.
 * Old B2i/V2 fixtures are not eligible. A browser reset does not clear the
 * non-secret permanent once-attempt marker; manual receipt recovery is separate.
 */
import {C3_HOST} from './phase1c_c3_readonly_supabase_transport.mjs';
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';
import {validateLocalScoreIntent,parseLocalOwnSnapshot}
 from './milestone1_signed_local_score_transport.mjs';
const EVENT_HASH='52c86dee4d72893b490ab991924335962a34fb39a26ffc11239f034390e549e7';
const MATCH_HASH='37e0555d5dd57fd9c93d12e93cdff6da45d26c1d63243d12eab1c0b9efc68015';
const PIN_KEY='fftt-m1-approved-one-attempt-52c86dee4d72';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PUB=/^sb_publishable_[A-Za-z0-9_-]{8,}$/;
const fail=reason=>{throw new AuthorityGateError(reason);};
const hex=buffer=>Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,'0')).join('');
async function pinned(value,expected){
 if(typeof value!=='string'||!UUID.test(value))fail('Private UUID is invalid');
 if(!globalThis.crypto?.subtle||!globalThis.TextEncoder)fail('Secure browser cryptography unavailable');
 const digest=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value.toLowerCase())));
 if(digest!==expected)fail('Event/match outside the ONE approved new fictional fixture');
 return value.toLowerCase();
}
export function createMilestone1HostedFixtureTransport({
 publishableKey,getAccessToken,fetchImpl,store
}={}){
 if(!PUB.test(publishableKey||'')||publishableKey.length>512
  ||typeof getAccessToken!=='function'||typeof fetchImpl!=='function'
  ||typeof store?.getItem!=='function'||typeof store?.setItem!=='function')
  fail('Explicit published key, signed user, fetch and local safety marker required');
 let scoreRequests=0,readRequests=0;const attempted=new Set();
 const onceUsed=()=>store.getItem(PIN_KEY)!==null;
 async function request(path,data){
   let jwt;
   try{jwt=await getAccessToken();}catch{fail('Verified user session required');}
   if(typeof jwt!=='string'||!JWT.test(jwt)||jwt.length>10000)
     fail('Verified individual user token required');
   let response;
   try{
     response=await fetchImpl(C3_HOST+path,{
       method:'POST',redirect:'error',credentials:'omit',cache:'no-store',
       headers:{apikey:publishableKey,Authorization:'Bearer '+jwt,
         Accept:'application/json','Content-Type':'application/json'},
       body:JSON.stringify(data),
     });
   }catch{fail('Hosted HTTP response uncertain; NEVER retry score');}
   if(response?.status!==200)fail('Hosted denial or uncertain outcome; NEVER retry score');
   try{return await response.json();}catch{fail('Malformed hosted response; NEVER retry score');}
 }
 return Object.freeze({
   async checkFixture({eventId,matchId}){
     const event=await pinned(eventId,EVENT_HASH);
     const match=await pinned(matchId,MATCH_HASH);
     return Object.freeze({eventId:event,matchId:match});
   },
   async submitScore(intent){
     const x=validateLocalScoreIntent(intent);
     await pinned(x.eventId,EVENT_HASH);
     await pinned(x.matchId,MATCH_HASH);
     if(x.expectedMatchVersion!==0||x.bracketGeneration!==1||x.tableNumber!==1)
       fail('Only untouched generation-1 browser rehearsal final may be scored');
     if(attempted.has(x.submissionId)||onceUsed())
       fail('One-time browser score attempt already used. Recover by receipt; never resend.');
     // Crash-safe best-effort local marker BEFORE the irreversible HTTP POST.
     // This contains no ID, score, JWT, player data or account identifier.
     // Browser profile reset is not authoritative: backend remains arbiter.
     try{
       store.setItem(PIN_KEY,'attempted');
       if(!onceUsed())fail('Safety marker failed');
     }catch{fail('Cannot persist non-secret one-time marker; no score transmitted');}
     attempted.add(x.submissionId);scoreRequests++;
     const raw=await request('/rest/v1/rpc/fftt_submit_match_result_v2',{
       p_event_id:x.eventId,p_match_id:x.matchId,
       p_bracket_generation:x.bracketGeneration,
       p_expected_match_version:x.expectedMatchVersion,
       p_submission_id:x.submissionId,p_winner_id:x.winnerId,
       p_game_scores:x.gameScores,p_table_number:x.tableNumber,
     });
     const required=['submission_id','status','match_id','match_version',
       'event_revision','generation','reason'];
     if(!raw||typeof raw!=='object'||Array.isArray(raw)
      ||Object.keys(raw).length!==required.length
      ||Object.keys(raw).some(k=>!required.includes(k))
      ||raw.submission_id!==x.submissionId||raw.match_id!==x.matchId
      ||!Number.isSafeInteger(raw.match_version)||raw.match_version<0
      ||!Number.isSafeInteger(raw.event_revision)||raw.event_revision<0
      ||raw.generation!==1
      ||!['accepted','rejected'].includes(raw.status)
      ||(raw.status==='accepted'
         ?raw.reason!==null||raw.match_version<=0
         :raw.reason!=='stale-match-version'))
       fail('Response identity/decision invalid; NEVER retry');
     return Object.freeze({status:raw.status,revision:raw.event_revision,
       generation:raw.generation,matchVersion:raw.match_version,
       receiptValidated:false});
   },
   async readOwnSnapshot({eventId,submissionId=null}={}){
     await pinned(eventId,EVENT_HASH);
     if(submissionId!==null&&(!UUID.test(submissionId)||typeof submissionId!=='string'))
       fail('Exact private request ID required');
     readRequests++;
     const raw=await request('/rest/v1/rpc/fftt_score_decision_snapshot_v2',{
       p_event_id:eventId,p_submission_id:submissionId,
     });
     const result=parseLocalOwnSnapshot(raw,{eventId,submissionId});
     if(result.decision){
       await pinned(result.decision.matchId,MATCH_HASH);
       if(result.decision.generation!==1)fail('Wrong generation in own receipt');
     }
     return result;
   },
   get oneAttemptAlreadyUsed(){try{return onceUsed();}catch{return true;}},
   get stats(){return Object.freeze({
     scoreRequests,readRequests,autoRetries:0,fixtureOnly:true,
   });},
 });
}
