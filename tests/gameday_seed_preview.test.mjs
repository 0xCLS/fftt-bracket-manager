import test from 'node:test';
import assert from 'node:assert/strict';
import {previewRefinedSeedSlots} from '../contracts/gameday_seed_preview.mjs';
const cases=[
  {n:24,counts:[7,8,5,3,1],before:1,after:0},
  {n:28,counts:[8,9,7,3,1],before:3,after:0},
  {n:31,counts:[9,10,8,3,1],before:1,after:0},
  {n:32,counts:[9,11,8,3,1],before:0,after:0},
  {n:33,counts:[10,11,8,3,1],before:1,after:1},
];
function players(counts){
  return counts.flatMap((count,r)=>Array.from({length:count},(_,i)=>({
    id:'L'+(r+1)+'-'+String(i+1).padStart(2,'0'),
    name:'L'+(r+1)+'-'+String(i+1).padStart(2,'0'),
    rating:r+1,ratingStatus:r>=3?'established':'provisional'
  })));
}
const pairs=slots=>{
  const result=[];
  for(let i=0;i<slots.length;i+=2)if(slots[i]&&slots[i+1])
    result.push([slots[i],slots[i+1]].sort().join(':'));
  return result.sort();
};
for(const scenario of cases)test('synthetic '+scenario.n+' check-ins: preserves roster, byes, opening pairings; measures post-bye mismatches',()=>{
  const input=players(scenario.counts),copy=structuredClone(input);
  const actual=previewRefinedSeedSlots(input);
  assert.equal(input.length,scenario.n);
  assert.equal(actual.baseline.length>=scenario.n,true);
  assert.equal(actual.byes,actual.baseline.length-scenario.n);
  assert.equal(actual.severeBaseline,scenario.before);
  assert.equal(actual.severeProposed,scenario.after);
  assert.equal(actual.changed,scenario.after<scenario.before);
  assert.deepEqual(actual.slots.filter(Boolean).sort(),actual.baseline.filter(Boolean).sort());
  assert.deepEqual(pairs(actual.slots),pairs(actual.baseline));
  assert.deepEqual(input,copy);
  assert.deepEqual(previewRefinedSeedSlots(input.slice().reverse()).slots,actual.slots,'deterministic independent of input order');
});
test('no changes for 33-player 64-slot case: cannot safely eliminate the structural mismatch with same byes and seeded draws',()=>{
  const out=previewRefinedSeedSlots(players(cases[4].counts));
  assert.equal(out.byes,31);
  assert.equal(out.changed,false);
});
