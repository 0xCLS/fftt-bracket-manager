/** Two separate role-scoped sessions share one volatile synthetic ledger.
 * NEVER calls fetch, storage, Supabase, WebSockets or any hosted endpoint.
 */
import {createMilestone1ScoreSession} from '../../contracts/milestone1_score_session.mjs';
const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P1='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P2='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const once=new Set();
const wait=()=>Promise.resolve();
export function createMilestone1SyntheticLab({makeId=()=>crypto.randomUUID()}={}){
 const state={revision:0,version:0,complete:false,accepted:null,decisions:new Map(),
   scoreRequests:0,networkRequests:0};
 const clients={};
 const names=Object.freeze({a:'Synthetic Alpha',b:'Synthetic Beta'});
 function matchdesk(){
   return state.complete?[]:[{event_id:E,bracket_generation:1,match_id:M,
     match_code:'C-0-0',match_version:state.version,
     player_1_id:P1,player_2_id:P2,
     player_1_name:names.a,player_2_name:names.b}];
 }
 for(const who of ['A','B']){
   let signed=true,loseAck=false;
   const controller=createMilestone1ScoreSession({
     eventId:E,isAuthenticated:()=>signed,getSubmissionId:makeId,
     allowDisposableLocalSimulation:true,
     readRole:async()=>signed?'scorekeeper':null,
     readMatchdesk:async()=>matchdesk(),
     readOwnSnapshot:async({submissionId})=>{
       await wait();
       return {eventId:E,revision:state.revision,generation:1,lifecycle:'active',
         decision:submissionId?state.decisions.get(who+'|'+submissionId)??null:null,
         source:'synthetic-memory-only',scoreWritesEnabled:false};
     },
     sendScore:async intent=>{
       state.scoreRequests++;
       if(once.has(who+'|'+intent.submissionId))
         throw Error('Duplicate fictional score attempt');
       once.add(who+'|'+intent.submissionId);
       const accepted=!state.complete&&intent.expectedMatchVersion===state.version;
       if(accepted){state.complete=true;state.version++;state.revision++;
         state.accepted={by:who,player:intent.winnerId,score:intent.gameScores};}
       const receipt={id:intent.submissionId,matchId:intent.matchId,
         status:accepted?'accepted':'rejected',
         reason:accepted?null:'stale-match-version',
         eventRevision:state.revision,matchVersion:state.version,generation:1};
       state.decisions.set(who+'|'+intent.submissionId,receipt);
       await wait();
       if(loseAck&&accepted){loseAck=false;throw Error('Fictional network timeout after commit');}
       return {status:receipt.status,revision:receipt.eventRevision,
         generation:receipt.generation,matchVersion:receipt.matchVersion,
         receiptValidated:false};
     },
   });
   clients[who]=Object.freeze({
     controller,
     loseNextAck(){loseAck=true;},
     expire(){signed=false;controller.pause();},
   });
 }
 return Object.freeze({
   eventId:E,matchId:M,p1:P1,p2:P2,names,
   devices:Object.freeze(clients),
   get publicView(){return Object.freeze({publishedEvents:0,publishedMatches:0,
     playerNamesExposed:false});},
   get organizerView(){return Object.freeze({
     revision:state.revision,matchVersion:state.version,
     completed:state.complete,acceptedCount:state.accepted?1:0,
     rejectedCount:[...state.decisions.values()].filter(d=>d.status==='rejected').length,
     submissions:state.scoreRequests,networkRequests:0,
   });},
 });
}
