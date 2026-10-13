/**
 * Milestone 1 signed READ-ONLY decision snapshot client (synthetic development).
 *
 * No scoring route, no refresh or admin route, no local storage or automatic
 * retry. Snapshot RPC V2 does not exist on the hosted development project yet.
 * Calling this with a real token can only perform an authorized READ attempt.
 *
 * JSON field validation cannot certify provenance: the returned decision is
 * ALWAYS unverified and NEVER unlocks the cloud recovery state machine.
 */
import {C3_HOST} from './phase1c_c3_readonly_supabase_transport.mjs';
import {decodeC11DecisionWire} from './phase1c_c11_decision_wire.mjs';
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY=/^sb_publishable_[A-Za-z0-9_-]{8,}$/;
const TOKEN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SNAPSHOT_PATH='/rest/v1/rpc/fftt_score_decision_snapshot_v2';
const guard=(condition,reason)=>{if(!condition)throw new AuthorityGateError(reason);};
const validId=value=>typeof value==='string'&&UUID.test(value);

export function createMilestone1ReadOnlySnapshotTransport({
  projectUrl=C3_HOST,publishableKey,getAccessToken,fetchImpl,
}={}){
  guard(projectUrl===C3_HOST,'Only the pinned synthetic dev project is supported');
  guard(typeof publishableKey==='string'&&KEY.test(publishableKey)&&publishableKey.length<512,
    'Only a public publishable key is permitted');
  guard(typeof getAccessToken==='function'&&typeof fetchImpl==='function',
    'Explicit signed-session provider and read-only request transport required');
  let calls=0;
  return Object.freeze({
    async readSnapshot({eventId,submissionId=null}={}){
      guard(validId(eventId),'Valid event required');
      guard(submissionId===null||validId(submissionId),'Valid submission scope required');
      let accessToken;
      try{accessToken=await getAccessToken();}
      catch{throw new AuthorityGateError('Signed session unavailable; writes remain paused');}
      guard(typeof accessToken==='string'&&TOKEN.test(accessToken)&&accessToken.length<10000,
        'Signed user-session JWT required');
      let response;
      calls++;
      try{
        response=await fetchImpl(C3_HOST+SNAPSHOT_PATH,{
          method:'POST',redirect:'error',credentials:'omit',cache:'no-store',
          headers:{apikey:publishableKey,Authorization:'Bearer '+accessToken,
            Accept:'application/json','Content-Type':'application/json'},
          body:JSON.stringify({p_event_id:eventId,p_submission_id:submissionId}),
        });
      }catch{throw new AuthorityGateError('Snapshot unavailable; writes remain paused');}
      guard(response?.status===200,'Snapshot denied or unavailable; writes remain paused');
      let body;
      try{body=await response.json();}
      catch{throw new AuthorityGateError('Invalid snapshot response; writes remain paused');}
      return decodeC11DecisionWire(body,{eventId,requestedSubmissionId:submissionId});
    },
    async submitScore(){
      throw new AuthorityGateError('Score writes disabled: unapplied v2 proposal and unapproved hosted change');
    },
    getReadCount(){return calls;},
  });
}
