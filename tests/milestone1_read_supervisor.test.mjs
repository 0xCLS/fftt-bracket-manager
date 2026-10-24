import test from 'node:test';
import assert from 'node:assert/strict';
import {createMilestone1ReadSupervisor as supervisor}
 from '../contracts/milestone1_read_supervisor.mjs';

function fixture({read=async()=>({status:'ready',revision:0}),accept=v=>v.status==='ready'}={}){
 let online=true,visible=true,signed=true;const timers=new Map();let seq=0,shown=[],cleared=[],calls=0;
 const s=supervisor({
  read:async()=>{calls++;return read();},
  accept,present:v=>shown.push(v),clear:r=>cleared.push(r),
  isAvailable:()=>online&&visible&&signed,
  setTimer:fn=>{const id=++seq;timers.set(id,fn);return id;},
  cancelTimer:id=>timers.delete(id),intervalMs:6000
 });
 const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
 const tick=async()=>{const fn=[...timers.values()][0];assert.ok(fn,'one pending timer');timers.clear();fn();await settle();};
 return {s,shown,cleared,timers,settle,tick,get calls(){return calls;},
  setOnline:v=>online=v,setVisible:v=>visible=v,setSigned:v=>signed=v};
}
test('starts only on explicit action; single read loop, revision updates and no score method',async()=>{
 let revision=0;const f=fixture({read:async()=>({status:'ready',revision:revision++})});
 assert.equal(f.calls,0);assert.equal(f.s.start(),true);assert.equal(f.s.start(),false);
 await f.settle();assert.equal(f.calls,1);assert.equal(f.timers.size,1);
 await f.tick();assert.equal(f.calls,2);assert.equal(f.shown[1].revision,1);
 assert.equal('submitScore' in f.s,false);assert.equal(f.s.stats.readOnly,true);
 f.s.pause('manual');assert.equal(f.timers.size,0);
 assert.equal(f.shown.length,2);assert.equal(f.cleared.at(-1),'manual');
});
test('pause signs out and clears while in-flight; late completion never renders/schedules',async()=>{
 let resolve;const f=fixture({read:()=>new Promise(r=>resolve=r)});
 f.s.start();await f.settle();assert.equal(f.calls,1);
 f.s.pause('signed-out');resolve({status:'ready',revision:8});
 await f.settle();assert.equal(f.shown.length,0);
 assert.equal(f.timers.size,0);assert.equal(f.s.running,false);
});
test('denial drops view and stops without automatic retry',async()=>{
 let n=0;const f=fixture({read:async()=>n++===0?{status:'ready',revision:1}:null});
 f.s.start();await f.settle();assert.equal(f.shown.length,1);
 await f.tick();assert.equal(f.cleared.at(-1),'denied');
 assert.equal(f.timers.size,0);assert.equal(f.s.stats.failures,1);
 assert.equal(f.s.running,false);
});
test('revision regression is rejected without showing stale view',async()=>{
 let n=2;const f=fixture({read:async()=>({status:'ready',revision:n--})});
 f.s.start();await f.settle();await f.tick();
 assert.equal(f.shown.length,1);assert.equal(f.cleared.at(-1),'denied');
 assert.equal(f.s.running,false);
});
test('offline or hidden tab requires human re-start; no auto-resume',async()=>{
 const f=fixture();f.s.start();await f.settle();f.setOnline(false);
 await f.tick();assert.equal(f.s.running,false);assert.equal(f.timers.size,0);
 assert.equal(f.s.start(),false);f.setOnline(true);
 assert.equal(f.calls,1);assert.equal(f.s.start(),true);await f.settle();
 f.setVisible(false);f.s.pause('hidden');
 assert.equal(f.calls,2);f.setVisible(true);assert.equal(f.calls,2);
});
test('invalid interval, missing safe predicates and post-dispose start fail closed',()=>{
 assert.throws(()=>supervisor({intervalMs:500}),/dependencies/);
 assert.throws(()=>supervisor({read:async()=>{}}),/dependencies/);
 const f=fixture();f.s.dispose();assert.throws(()=>f.s.start(),/disposed/);
});
test('private signed session expiry drops all results',async()=>{
 const f=fixture();f.s.start();await f.settle();f.setSigned(false);
 await f.tick();assert.equal(f.shown.length,1);
 assert.equal(f.cleared.at(-1),'unavailable');assert.equal(f.timers.size,0);
});
