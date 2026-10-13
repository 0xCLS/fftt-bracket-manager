/**
 * FFTT Milestone 1 signed score transport for DISPOSABLE LOCAL Supabase only.
 * HARD BLOCK: never send a score POST to hosted fftt-bracket-manager-dev,
 * never target real events, and never use a privileged key.
 *
 * This is a browser/network integration component, NOT an event-day scorer.
 * Caller supplies an existing verified signed user JWT in process memory.
 * Every submission ID is single-use per transport instance, regardless of
 * HTTP success, timeout, or rejection. There is NO retry/backoff/queue/storage.
 * The server must also verify staff and atomically protect match version.
 */
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';

const HOST='http://127.0.0.1:54321';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const KEY=/^(sb_publishable_[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const terminal=['submission_id','status','match_id','match_version','event_revision','generation','reason'];
const snapFields=['event_id','revision','generation','lifecycle','submission_id','decision'];
const snapDecision=['id','status','match_id','match_version','event_revision','generation','reason'];
const validId=x=>typeof x==='string'&&UUID.test(x);
const natural=x=>Number.isSafeInteger(x)&&x>=0;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
  &&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const sameKeys=(x,fields)=>plain(x)&&Object.keys(x).length===fields.length
  &&Object.keys(x).every(k=>fields.includes(k));
const requireLocal=(condition,msg)=>{if(!condition)throw new AuthorityGateError(msg);};
const scorePath='/rest/v1/rpc/fftt_submit_match_result_v2';
const snapshotPath='/rest/v1/rpc/fftt_score_decision_snapshot_v2';

export function validateLocalScoreIntent(x){
 requireLocal(plain(x)&&sameKeys(x,['eventId','matchId','submissionId','winnerId',
  'bracketGeneration','expectedMatchVersion','tableNumber','gameScores']),
  'Incomplete or unexpected score intent');
 requireLocal(validId(x.eventId)&&validId(x.matchId)&&validId(x.submissionId)
  &&validId(x.winnerId),'Invalid score identity');
 requireLocal(natural(x.bracketGeneration)&&natural(x.expectedMatchVersion)
  &&Number.isSafeInteger(x.tableNumber)&&x.tableNumber>=1&&x.tableNumber<=99,
  'Invalid score versions/table');
 requireLocal(typeof x.gameScores==='string'&&x.gameScores.length<=128
  &&/^\d{1,2}-\d{1,2}(,\s*\d{1,2}-\d{1,2}){1,6}$/.test(x.gameScores),
  'Expected explicit valid-looking fictional game scores');
 return Object.freeze({...x});
}
function parseTerminal(raw,intent){
 requireLocal(sameKeys(raw,terminal)
  &&raw.submission_id===intent.submissionId
  &&raw.match_id===intent.matchId
  &&natural(raw.match_version)&&natural(raw.event_revision)
  &&raw.generation===intent.bracketGeneration
  &&(raw.status==='accepted'?raw.match_version>intent.expectedMatchVersion:true)
  &&(raw.status==='accepted'||raw.status==='rejected')
  &&(raw.status==='accepted'?raw.reason===null:raw.reason==='stale-match-version'),
  'Invalid or unexpected score response; outcome unknown');
 return Object.freeze({status:raw.status,revision:raw.event_revision,
  generation:raw.generation,matchVersion:raw.match_version,receiptValidated:false});
}
export function parseLocalOwnSnapshot(raw,{eventId,submissionId=null}={}){
 requireLocal(validId(eventId)&&(submissionId===null||validId(submissionId)),
  'Invalid snapshot scope');
 requireLocal(sameKeys(raw,snapFields)&&raw.event_id===eventId
  &&raw.submission_id===submissionId
  &&natural(raw.revision)&&natural(raw.generation)
  &&raw.lifecycle==='active','Unexpected or inactive V2 snapshot');
 let decision=null;
 if(raw.decision!==null){
   const d=raw.decision;
   requireLocal(submissionId!==null&&sameKeys(d,snapDecision)
     &&d.id===submissionId&&validId(d.match_id)
     &&natural(d.match_version)&&natural(d.event_revision)
     &&natural(d.generation)&&d.event_revision<=raw.revision
     &&d.generation<=raw.generation
     &&(d.status==='accepted'||d.status==='rejected')
     &&(d.status==='accepted'?d.reason===null:d.reason==='stale-match-version'),
     'Malformed, mismatched or private V2 decision');
   decision=Object.freeze({id:d.id,matchId:d.match_id,status:d.status,
     reason:d.reason,matchVersion:d.match_version,
     eventRevision:d.event_revision,generation:d.generation});
 }
 return Object.freeze({eventId,revision:raw.revision,generation:raw.generation,
   lifecycle:raw.lifecycle,decision,source:'synthetic-local-wire',scoreWritesEnabled:false});
}
export function createMilestone1LocalSignedScoreTransport({
  projectUrl=HOST,publishableKey,getAccessToken,fetchImpl
}={}){
 requireLocal(projectUrl===HOST,'Score writes restricted to fixed loopback disposable Supabase');
 requireLocal(typeof publishableKey==='string'&&KEY.test(publishableKey)
  &&publishableKey.length<512&&!publishableKey.startsWith('sb_secret_'),
  'Public local Supabase key required; secret/service keys prohibited');
 requireLocal(typeof getAccessToken==='function'&&typeof fetchImpl==='function',
  'Injected signed Auth token and transport required');
 const attempted=new Set();
 let submitted=0,reads=0;
 async function request(path,payload){
   let token;
   try{token=await getAccessToken();}
   catch{throw new AuthorityGateError('Signed session unavailable');}
   requireLocal(typeof token==='string'&&JWT.test(token)&&token.length<10000,
     'Verified existing user JWT required');
   let response;
   try {
     response=await fetchImpl(HOST+path,{
       method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
       headers:{apikey:publishableKey,Authorization:'Bearer '+token,
        'Content-Type':'application/json',Accept:'application/json'},
       body:JSON.stringify(payload),
     });
   }catch{throw new AuthorityGateError('Network response unknown; never retry score');}
   requireLocal(response?.status===200,'Denied, expired or uncertain; never retry score');
   let body;
   try{body=await response.json();}
   catch{throw new AuthorityGateError('Invalid JSON response; never retry score');}
   return body;
 }
 return Object.freeze({
   async submitScore(intent){
     const x=validateLocalScoreIntent(intent);
     requireLocal(!attempted.has(x.submissionId),'Duplicate submission forbidden, even after timeout');
     attempted.add(x.submissionId);
     submitted++;
     const raw=await request(scorePath,{
       p_event_id:x.eventId,p_match_id:x.matchId,
       p_bracket_generation:x.bracketGeneration,
       p_expected_match_version:x.expectedMatchVersion,
       p_submission_id:x.submissionId,p_winner_id:x.winnerId,
       p_game_scores:x.gameScores,p_table_number:x.tableNumber,
     });
     return parseTerminal(raw,x); // still unverified until caller's own signed snapshot
   },
   async readOwnSnapshot({eventId,submissionId=null}={}){
     requireLocal(validId(eventId)&&(submissionId===null||validId(submissionId)),
       'Invalid snapshot request');
     reads++;
     const raw=await request(snapshotPath,{p_event_id:eventId,p_submission_id:submissionId});
     return parseLocalOwnSnapshot(raw,{eventId,submissionId});
   },
   getTelemetry(){return Object.freeze({scoreRequests:submitted,snapshotRequests:reads,
       cloudProductionEnabled:false,queuedScores:0,automaticRetries:0});},
 });
}
