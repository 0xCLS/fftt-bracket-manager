/**
 * Isolated synthetic-only score/recovery controller.
 * This module has NO fetch, Supabase connection, credential, storage or UI.
 * An injected in-memory test transport drives a realistic score lifecycle.
 *
 * It is NOT a production live scorer and never treats untrusted JSON as
 * verified server proof. The existing index.html does not import it.
 */
import {
  PHASE,AuthorityGateError,initialCloudState,canSendCloudIntent,
  beginCloudIntent,acknowledgeCloudIntent,connectivityLost,
  connectivityRestored,revisionNotice,
} from './phase1c_disconnect_reference.mjs';
import {decodeC11DecisionWire} from './phase1c_c11_decision_wire.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYS=['submission_id','status','match_id','match_version','event_revision','generation','reason'];
const goodId=x=>typeof x==='string'&&UUID.test(x);
const natural=x=>Number.isSafeInteger(x)&&x>=0;
const fail=reason=>{throw new AuthorityGateError(reason);};
const exactKeys=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).length===keys.length&&Object.keys(x).every(k=>keys.includes(k));
const result=(status)=>Object.freeze({
  simulationStatus:status,claimedPersisted:false,retryAllowed:false,
  automaticReplayAllowed:false,
});

function checkIntent(x,state) {
  if(!x||typeof x!=='object'||Array.isArray(x)
    ||x.eventId!==state.eventId||x.bracketGeneration!==state.generation
    ||!goodId(x.submissionId)||!goodId(x.matchId)||!goodId(x.winnerId)
    ||!natural(x.expectedMatchVersion)
    ||!Number.isSafeInteger(x.tableNumber)||x.tableNumber<1
    ||typeof x.gameScores!=='string'||x.gameScores.length>128)
    fail('Invalid synthetic score intent');
}
function checkDecision(r,intent,previous) {
  if(!exactKeys(r,KEYS)||r.submission_id!==intent.submissionId
     ||r.match_id!==intent.matchId
     ||!natural(r.match_version)||!natural(r.event_revision)
     ||!natural(r.generation)||r.generation!==previous.generation
     ||r.event_revision<previous.revision)fail('Malformed or stale synthetic decision');
  if(r.status==='accepted') {
    if(r.reason!==null||r.event_revision<=previous.revision
       ||r.match_version<=intent.expectedMatchVersion)
      fail('Invalid accepted decision');
  }else if(r.status==='rejected'){
    if(r.reason!=='stale-match-version')
      fail('Unknown rejected-decision reason');
  }else fail('No terminal decision');
}

/** This class intentionally cannot perform a real score or unlock recovery. */
export class Milestone1SyntheticCoordinator {
  #state; #transport;
  constructor({eventId,revision,generation,transport}) {
    if(!transport||typeof transport.assertCurrentRole!=='function'
       ||typeof transport.submitSynthetic!=='function'
       ||typeof transport.readSyntheticSnapshot!=='function')
      fail('Inject complete in-memory synthetic transport');
    this.#state=initialCloudState({eventId,revision,generation});
    this.#transport=transport;
  }
  get status(){
    return Object.freeze({
      phase:this.#state.phase,revision:this.#state.revision,
      generation:this.#state.generation,stale:this.#state.stale,
      simulationCanSubmit:canSendCloudIntent(this.#state),
      hasUnknownOutcome:!!this.#state.unresolvedCloudRequest,
    });
  }
  offline(){this.#state=connectivityLost(this.#state);return this.status;}
  online(){this.#state=connectivityRestored(this.#state);return this.status;}
  notice(eventId){this.#state=revisionNotice(this.#state,eventId);return this.status;}

  async submitSynthetic(intent) {
    if(!canSendCloudIntent(this.#state))fail('Synthetic scoring is paused');
    checkIntent(intent,this.#state);
    const before=this.#state;
    this.#state=beginCloudIntent(this.#state,{
      eventId:intent.eventId,submissionId:intent.submissionId,
    });
    let decision;
    try{
      const role=await this.#transport.assertCurrentRole({eventId:intent.eventId});
      if(role!=='organizer'&&role!=='scorekeeper')fail('Not an authorized synthetic staff role');
      if(this.#state.phase!==PHASE.READY||this.#state.stale)fail('Disconnected during role check');
      decision=await this.#transport.submitSynthetic(Object.freeze({...intent}));
      if(this.#state.phase!==PHASE.READY||this.#state.stale
         ||this.#state.cloudRequest!==intent.submissionId)
        fail('Delayed result after disconnection');
      checkDecision(decision,intent,before);
      this.#state=acknowledgeCloudIntent(this.#state,{
        eventId:intent.eventId,submissionId:intent.submissionId,
        result:decision.status,revision:decision.event_revision,
        generation:decision.generation,
      });
      return result(decision.status);
    }catch {
      // Even a 400/403/409/timeout might follow an accepted score;
      // only a successfully decoded durable terminal ACK can end uncertainty.
      this.#state=connectivityLost(this.#state);
      return result('unknown');
    }
  }

  async inspectRecovery(){
    if(this.#state.phase!==PHASE.RELOADING)
      fail('Recovery inspection requires reconnect/reloading');
    let parsed;
    try{
      const raw=await this.#transport.readSyntheticSnapshot({
        eventId:this.#state.eventId,
        submissionId:this.#state.unresolvedCloudRequest,
      });
      parsed=decodeC11DecisionWire(raw,{
        eventId:this.#state.eventId,
        requestedSubmissionId:this.#state.unresolvedCloudRequest,
      });
      if(parsed.revision<this.#state.revision
         ||parsed.generation<this.#state.generation)fail('Regressed snapshot');
    }catch {
      return Object.freeze({outcome:'invalid-or-unavailable',verified:false,
        canResume:false,retryAllowed:false});
    }
    // The model's JSON parser *always* returns decisionVerifiedFromServer=false.
    // It is impossible for this component to assert trusted server provenance.
    return Object.freeze({outcome:parsed.status,verified:false,canResume:false,
      retryAllowed:false});
  }
}
