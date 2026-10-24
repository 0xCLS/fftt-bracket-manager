/** Milestone 1 browser-connected, synthetic-only READ model.
 * Real pinned Supabase signed roles, private Match Desk and V2 revision/own
 * decision snapshots. ZERO score writes, admin actions, token storage,
 * polling, publication, fallback uploads or auto-retries.
 *
 * A double-read prevents presenting a desk at a contradictory revision;
 * it does NOT certify an atomic match-list snapshot or unlock score writes.
 * Every failure, tab pause and sign-out discards the previous private view.
 */
import {AuthorityGateError} from './phase1c_disconnect_reference.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MATCH_FIELDS=Object.freeze([
 'event_id','bracket_generation','match_id','match_code','match_version',
 'bracket','round_number','slot','player_1_id','player_2_id',
 'player_1_name','player_2_name','is_championship_final','table_number'
]);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)
 &&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
const strictMatch=(m,eventId,generation)=>{
 if(!plain(m)||Object.keys(m).some(k=>!MATCH_FIELDS.includes(k))
   ||m.event_id!==eventId||m.bracket_generation!==generation
   ||typeof m.match_code!=='string'||!/^[Cc]-[0-9]+-[0-9]+$/.test(m.match_code)
   ||!nonnegative(m.match_version)||!nonnegative(m.round_number)
   ||!nonnegative(m.slot)||m.bracket!=='championship'&&m.bracket!=='consolation'
   ||typeof m.player_1_name!=='string'||typeof m.player_2_name!=='string'
   ||m.player_1_name.length>160||m.player_2_name.length>160
   ||!UUID.test(m.match_id)||!UUID.test(m.player_1_id)||!UUID.test(m.player_2_id)
   ||m.player_1_id===m.player_2_id)
   throw new AuthorityGateError('Invalid private Match Desk row');
 return Object.freeze({
   code:m.match_code,bracket:m.bracket,round:m.round_number+1,
   players:m.player_1_name+' vs '+m.player_2_name,
   version:m.match_version,table:m.table_number,
 });
};
const closed=(status)=>Object.freeze({status,role:null,revision:null,
 generation:null,matches:Object.freeze([]),authoritativeForScoring:false});
export function createMilestone1ConnectedDesk({readRole,readMatchdesk,readSnapshot,isAuthenticated}={}){
 if([readRole,readMatchdesk,readSnapshot,isAuthenticated].some(f=>typeof f!=='function'))
   throw new AuthorityGateError('Explicit signed and scoped reads required');
 let state=closed('signed-out'),epoch=0,loading=false,disposed=false;
 const invalidate=(reason='paused')=>{
   epoch++;loading=false;state=closed(reason);return state;
 };
 const active=stamp=>!disposed&&stamp===epoch&&isAuthenticated();
 return Object.freeze({
   get view(){return state;},
   signOut(){return invalidate('signed-out');},
   pause(){return invalidate('paused');},
   dispose(){disposed=true;return invalidate('signed-out');},
   async refresh(eventId){
     if(disposed||loading)throw new AuthorityGateError('Read in progress or controller disposed');
     if(typeof eventId!=='string'||!UUID.test(eventId)||!isAuthenticated()){
       invalidate('denied');throw new AuthorityGateError('No verified scoped session or event');
     }
     const stamp=++epoch;loading=true;state=closed('loading');
     try{
       const role=await readRole({eventId});
       if(!active(stamp))return state;
       if(role!=='organizer'&&role!=='scorekeeper')throw new AuthorityGateError('Not staff');
       const first=await readSnapshot({eventId,submissionId:null});
       if(!active(stamp))return state;
       if(first?.eventId!==eventId||!nonnegative(first.revision)
         ||!nonnegative(first.generation)||first.status!=='unknown'
         ||first.cloudWritesEnabled!==false)throw new AuthorityGateError('Untrusted snapshot');
       const desk=await readMatchdesk({eventId});
       if(!active(stamp))return state;
       if(!Array.isArray(desk)||desk.length>256)throw new AuthorityGateError('Unexpected Match Desk');
       const matches=desk.map(row=>strictMatch(row,eventId,first.generation));
       const second=await readSnapshot({eventId,submissionId:null});
       if(!active(stamp))return state;
       if(second?.eventId!==eventId||second.revision!==first.revision
         ||second.generation!==first.generation||second.status!=='unknown'
         ||second.cloudWritesEnabled!==false)
         throw new AuthorityGateError('Event changed during read; refresh manually');
       state=Object.freeze({status:'ready',role,
         revision:first.revision,generation:first.generation,
         matches:Object.freeze(matches),authoritativeForScoring:false});
       return state;
     }catch{
       if(active(stamp))state=closed('denied');
       return state; // Never propagate private API errors or an earlier cached Match Desk.
     }finally{if(stamp===epoch)loading=false;}
   },
   async submitScore(){throw new AuthorityGateError('Score writes disabled; fixtures consumed');},
   async enableFallback(){throw new AuthorityGateError('Isolated fallback requires a separate organizer-controlled device');},
 });
}
