import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from './harness.mjs';
import {createStaffCore,createPendingLedger} from '../../app/staff_core.mjs';

test('authenticated directory across renewal, suspend, resume, and expiry', {timeout:120000}, async()=>{
 const w=await createWorld({ttlSeconds:3600});
 const d=w.device('directory','org'); await d.signIn();
 const core=createStaffCore({session:d.session,api:d.api,scoreTransport:d.scoreTransport,now:w.now,
   ledger:createPendingLedger(d.storage),peopleClient:{request:async()=>({people:[]})}});
 await core.started({role:'organizer',eventId:w.eventId});
 assert.equal((await core.actions.loadStaffDirectory()).ok,true);
 w.clock.t+=59*60*1000;d.session.touch();
 assert.equal((await core.actions.loadStaffDirectory()).ok,true,'token renewal retains verified access');
 d.session.suspend();core.pause();
 assert.equal((await core.actions.loadStaffDirectory()).ok,false);
 assert.equal(core.state.staffDirectory.status,'idle');
 assert.equal((await core.resume()).ok,true);
 assert.equal((await core.actions.loadStaffDirectory()).ok,true,'directory recovers after session reproof');
 w.clock.t+=121*60*1000;
 assert.equal((await core.actions.loadStaffDirectory()).ok,false);
 assert.equal(core.state.signedIn,false,'idle expiry ends the session and clears private data');
 assert.equal(core.state.staffDirectory.people.length,0);
});
