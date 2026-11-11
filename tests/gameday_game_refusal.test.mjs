import test from 'node:test';
import assert from 'node:assert/strict';
import {createGamedayScoreTransport} from '../contracts/gameday_score_transport.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const token = 'abc.def.ghi', key = 'sb_publishable_abcdefgh';
const single = {eventId:id,matchId:id,submissionId:id,generation:1,matchVersion:0,epoch:0,revision:0,bestOf:3,points:11,gameIndex:1,player1Score:11,player2Score:7,reason:null};
const doubles = {eventId:id,submissionId:id,teamKey:'a'.repeat(32),revision:0,bestOf:3,points:11,gameIndex:1,team1Score:11,team2Score:7,reason:null};
const refusal = {code:'P0001',message:'fftt_conflict',details:'player-withdrawn',hint:null};
const make = fetchImpl => createGamedayScoreTransport({publishableKey:key,fetchImpl});
for (const [method,intent] of [['submitCompletedGame',single],['submitDoublesGame',doubles]]) {
  test(`${method}: exact withdrawal conflict is definitive; same ID remains one-shot`, async()=>{
    let calls=0; const t=make(async()=>{calls++;return {status:400,json:async()=>refusal};});
    await assert.rejects(t[method](token,intent),e=>e.definiteRefusal===true && e.detail==='player-withdrawn');
    await assert.rejects(t[method](token,intent),/Duplicate submission/);
    assert.equal(calls,1);
  });
  for (const [name,status,body] of [
    ['wrong status',409,refusal], ['missing code',400,{message:'fftt_conflict',details:'player-withdrawn',hint:null}],
    ['wrong code',400,{...refusal,code:'22023'}], ['wrong message',400,{...refusal,message:'fftt_validation_error'}],
    ['wrong detail',400,{...refusal,details:'other'}], ['missing hint',400,{code:'P0001',message:'fftt_conflict',details:'player-withdrawn'}],
    ['extra fields',400,{...refusal,extra:true}], ['malformed',400,null],
  ]) test(`${method}: ${name} remains uncertain`,async()=>{
    const t=make(async()=>({status,json:async()=>{if(body===null) throw new SyntaxError(); return body;}}));
    await assert.rejects(t[method](token,intent),e=>!e.definiteRefusal);
    await assert.rejects(t[method](token,intent),/Duplicate submission/);
  });
  test(`${method}: network timeout remains uncertain and cannot resend`,async()=>{
    let calls=0; const t=make(async()=>{calls++;throw new Error('timeout');});
    await assert.rejects(t[method](token,intent),e=>!e.definiteRefusal);
    await assert.rejects(t[method](token,intent),/Duplicate submission/); assert.equal(calls,1);
  });
}
