import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMilestone1PublicDisplay} from '../contracts/milestone1_public_display.mjs';
import {projectPublishedResults} from '../contracts/milestone1_public_results.mjs';
const E='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const rowsWith=(winner=null)=>[{event_id:E,event_name:'Synthetic Open',event_date:'2099-01-01',
 status:'active',updated_at:'x',brackets:[{name:'championship',matches:[
  {match_id:'C-0-0',bracket:'championship',round:0,slot:0,player_1_name:'Ada',
   player_2_name:'Bo',winner_name:winner,game_scores:winner?'11-7':'',status:winner?'complete':'pending'}]}]}];
function rig(over={}){
 const clock={t:1000};const timers=[];let source=async()=>rowsWith(),avail=true,reads=0;
 const d=createMilestone1PublicDisplay({
  read:async()=>{reads++;return source();},project:projectPublishedResults,
  isAvailable:()=>avail,now:()=>clock.t,
  setTimer:(fn,ms)=>{const job={fn,ms,live:true};timers.push(job);return job;},
  cancelTimer:j=>{if(j)j.live=false;},...over});
 const flush=()=>new Promise(r=>setImmediate(r));
 return {d,clock,timers,reads:()=>reads,flush,
  setSource:f=>{source=f;},setAvail:v=>{avail=v;},
  async fireNext(){const j=timers.filter(x=>x.live).at(-1);j.live=false;await j.fn();await flush();},
  live:()=>timers.filter(x=>x.live)};
}
test('empty before the first read; first success is current and read-only',async()=>{
 const r=rig();assert.equal(r.d.view.state,'empty');
 r.d.start();await r.flush();
 const v=r.d.view;assert.equal(v.state,'current');assert.equal(v.readOnly,true);
 assert.equal(v.events[0].brackets[0].matches[0].players,'Ada vs Bo');
 assert.equal(r.live().at(-1).ms,6000);
});
test('network outage keeps public data but ages it: current -> stale -> expired, never refreshed',async()=>{
 const r=rig();r.d.start();await r.flush();
 r.setSource(async()=>{throw new Error('down');});
 r.clock.t+=6000;await r.fireNext();
 assert.equal(r.d.view.state,'current','young data may still be current');
 r.clock.t+=15000; // 21 s old
 assert.equal(r.d.view.state,'stale');assert.equal(r.d.view.events.length,1);
 assert.equal(r.d.view.ageMs,21000);
 r.clock.t+=100_000; // 121 s old
 assert.equal(r.d.view.state,'empty','expired data is dropped, not shown');
 assert.equal(r.d.view.events.length,0);
});
test('failed reads back off exponentially up to the bound and recover on success',async()=>{
 const r=rig();r.d.start();await r.flush();
 r.setSource(async()=>{throw new Error('down');});
 const waits=[];
 for(let i=0;i<6;i++){r.clock.t+=1000;await r.fireNext();waits.push(r.live().at(-1).ms);}
 assert.deepEqual(waits,[12000,24000,48000,60000,60000,60000]);
 assert.equal(r.d.view.consecutiveFailures,6);
 r.setSource(async()=>rowsWith('Ada'));
 await r.fireNext();
 assert.equal(r.d.view.state,'current');assert.equal(r.d.view.consecutiveFailures,0);
 assert.equal(r.d.view.events[0].brackets[0].matches[0].winner,'Ada');
 assert.equal(r.live().at(-1).ms,6000);
});
test('private or malformed data blanks the display at once and is never aged back in',async()=>{
 const leaks=[
  rows=>{rows[0].brackets[0].matches[0].player_1_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';return rows;},
  rows=>{rows[0].contact='canary-contact@private.invalid';return rows;},
  rows=>{rows[0].brackets[0].matches[0].winner_name='Mallory';return rows;},
  rows=>'not rows',
 ];
 for(const mutate of leaks){
  const r=rig();r.d.start();await r.flush();
  assert.equal(r.d.view.state,'current');
  r.setSource(async()=>mutate(rowsWith()));
  r.clock.t+=6000;await r.fireNext();
  assert.equal(r.d.view.state,'empty');assert.equal(r.d.view.blankedByInvalidData,true);
  assert.equal(r.d.view.events.length,0);
  assert.ok(r.live().length>=1,'keeps trying on backoff; display stays blank');
 }
});
test('a read error classified as invalid data blanks at once; an unclassified one only ages',async()=>{
 const bad=Object.assign(new Error('forbidden field'),{unsafe:true});
 const r=rig({isInvalidData:e=>e.unsafe===true});
 r.d.start();await r.flush();
 r.setSource(async()=>{throw new Error('plain outage');});
 r.clock.t+=6000;await r.fireNext();
 assert.equal(r.d.view.state,'current','plain outage keeps young data');
 r.setSource(async()=>{throw bad;});
 await r.fireNext();
 assert.equal(r.d.view.state,'empty');assert.equal(r.d.view.blankedByInvalidData,true);
 const t=rig({isInvalidData:()=>{throw new Error('classifier bug');}});
 t.d.start();await t.flush();
 t.setSource(async()=>{throw new Error('x');});
 t.clock.t+=6000;await t.fireNext();
 assert.equal(t.d.view.state,'empty','a broken classifier fails closed');
});
test('hidden or offline display performs no read and its view keeps aging',async()=>{
 const r=rig();r.d.start();await r.flush();const base=r.reads();
 r.setAvail(false);
 for(let i=0;i<4;i++){r.clock.t+=6000;await r.fireNext();} // 24 s > 20 s stale bound
 assert.equal(r.reads(),base,'no reads while unavailable');
 assert.equal(r.d.view.state,'stale');
 r.setAvail(true);r.clock.t+=6000;await r.fireNext();
 assert.equal(r.d.view.state,'current','resumes automatically; reads are harmless');
});
test('a throwing availability check is treated as unavailable, never as an unhandled error',async()=>{
 let boom=false;
 const r=rig({isAvailable:()=>{if(boom)throw new Error('probe failed');return true;}});
 r.d.start();await r.flush();const base=r.reads();
 boom=true;r.clock.t+=6000;await r.fireNext();
 assert.equal(r.reads(),base);assert.ok(r.live().length>=1,'keeps polling for availability');
});
test('stop() discards the view and ignores a read that finishes afterwards',async()=>{
 let release;const r=rig({});
 r.setSource(()=>new Promise(res=>{release=()=>res(rowsWith());}));
 r.d.start();await r.flush();
 r.d.stop();release();await r.flush();
 assert.equal(r.d.view.state,'empty');assert.equal(r.live().length,0);
 assert.equal(r.d.running,false);
});
test('overlapping reads cannot start; start is idempotent',async()=>{
 let release,reads=0;const r=rig({});
 r.setSource(()=>{reads++;return new Promise(res=>{release=()=>res(rowsWith());});});
 assert.equal(r.d.start(),true);assert.equal(r.d.start(),false);
 r.d.refreshNow();await r.flush();
 assert.equal(reads,1);release();await r.flush();
 assert.equal(r.d.view.state,'current');
});
test('a clock that moves backwards fails closed instead of looking fresh',async()=>{
 const r=rig();r.d.start();await r.flush();
 r.clock.t-=60_000;
 assert.equal(r.d.view.state,'empty');
});
test('timings must be bounded and ordered',()=>{
 const base={read:async()=>[],project:projectPublishedResults,isAvailable:()=>true};
 for(const bad of [{intervalMs:500},{staleAfterMs:1000},{expireAfterMs:20000},
  {expireAfterMs:900001},{maxBackoffMs:1000},{read:null},{intervalMs:'6000'}])
  assert.throws(()=>createMilestone1PublicDisplay({...base,...bad}),undefined,JSON.stringify(bad));
});
test('displayed events are exactly the allowlisted projection; nothing is invented',async()=>{
 const r=rig();r.d.start();await r.flush();
 assert.deepEqual(r.d.view.events,projectPublishedResults(rowsWith()));
 assert.equal(Object.isFrozen(r.d.view.events),true);
 const text=readFileSync(new URL('../contracts/milestone1_public_display.mjs',import.meta.url),'utf8');
 for(const banned of ['fetch(','Authorization','localStorage','sessionStorage','indexedDB',
  'window.','navigator.','document.','submitScore','publish','winner_name','POST'])
  assert.equal(text.includes(banned),false,banned);
});
