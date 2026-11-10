/** #79 event-level departure / return: disposable SQL and fictional browser only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserWorld} from './browser_world.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';
import {parsePlayerDepartures} from '../../contracts/gameday_api.mjs';

const SQL=fs.readFileSync(new URL('../../supabase/proposals/FFTT3_POSTSTART_DEPARTURES_20261110_DO_NOT_APPLY.sql',import.meta.url),'utf8');
const T=30000;
async function world() {
  const w=await createBrowserWorld({players:8,staffRoles:true});
  const db=w.fake.local,E=w.eventId;
  await db.db.exec(SQL);
  await db.rpc(w.ids.org,'fftt_set_checkin_bulk_v3',{p_event_id:E,p_player_ids:null,p_checked_in:true});
  const snap=await db.rpc(w.ids.org,'fftt_organizer_snapshot_v3',{p_event_id:E});
  await db.rpc(w.ids.org,'fftt_build_championship_v3',{
    p_event_id:E,p_slots:seedSlots(enginePlayers(snap.players)),
    p_expected_generation:0,p_confirm:false});
  const current=()=>db.rpc(w.ids.org,'fftt_organizer_snapshot_v3',{p_event_id:E});
  const read=(who)=>db.rpc(who,'fftt_player_departures_v1',{p_event_id:E});
  const set=async(who,player,state,reason,revision=null)=>{
    const s=await current();
    return db.rpc(who,'fftt_set_player_departure_v1',{
      p_event_id:E,p_player_id:player,p_expected_revision:revision??s.event.revision,
      p_expected_generation:s.event.generation,p_state:state,p_reason:reason});
  };
  return {w,db,E,current,read,set};
}
test('Strict private departure response parser fails closed',()=>{
  const e='00000000-0000-4000-8000-000000000001';
  assert.deepEqual(parsePlayerDepartures({event_id:e,revision:1,players:[]}).players,[]);
  assert.throws(()=>parsePlayerDepartures({event_id:e,revision:1,players:[{player_id:e,withdrawn:true}]}));
  assert.throws(()=>parsePlayerDepartures({event_id:e,revision:1,players:[],contacts:[]}));
});
test('Role guards, revision guard, departure/return audit, no score or bracket rewrite', {timeout:240000},async()=>{
  const {w,db,E,current,read,set}=await world();
  try {
    const before=await current(),player=before.players[0].id;
    assert.deepEqual((await read(w.ids.org)).players,[]);
    assert.deepEqual((await read(w.ids.bm)).players,[]);
    await assert.rejects(read(w.ids.a));
    await assert.rejects(read(w.ids.out));
    await assert.rejects(db.rpc(null,'fftt_player_departures_v1',{p_event_id:E}));
    await assert.rejects(set(w.ids.a,player,'withdrawn','Left early'));
    await assert.rejects(set(w.ids.out,player,'withdrawn','Left early'));
    await assert.rejects(set(w.ids.org,player,'withdrawn','x'));
    await assert.rejects(set(w.ids.org,player,'withdrawn','Left early',before.event.revision-1));
    const first=await set(w.ids.bm,player,'withdrawn','Unable to continue (injury)');
    assert.equal(first.status,'updated');
    let entries=await read(w.ids.org);
    assert.equal(entries.players.length,1);
    assert.equal(entries.players[0].player_id,player);
    assert.equal(entries.players[0].withdrawn,true);
    await assert.rejects(set(w.ids.org,player,'withdrawn','Left early'));
    assert.equal((await set(w.ids.org,player,'returned','Player returned to venue')).status,'updated');
    entries=await read(w.ids.bm);
    assert.equal(entries.players[0].withdrawn,false);
    assert.equal(entries.players[0].return_reason,'Player returned to venue');
    await assert.rejects(set(w.ids.org,player,'returned','Returned again'));
    assert.equal((await set(w.ids.org,player,'withdrawn','Left tournament early')).status,'updated');
    const after=await current();
    assert.deepEqual(after.matches,before.matches,'no bracket or result rewritten');
    assert.deepEqual(after.players,before.players,'no roster or check-in rewritten');
    assert.equal(after.event.generation,before.event.generation,'generation unchanged');
    const audits=await db.admin("select operation,reason,event_revision from fftt_private.audit_events where event_id=$1 and operation='player_departure_changed' order by event_revision",[E]);
    assert.deepEqual(audits.map(x=>x.reason),['Unable to continue (injury)','Player returned to venue','Left tournament early']);
    assert.deepEqual(audits.map(x=>x.operation),['player_departure_changed','player_departure_changed','player_departure_changed']);
    // No opaque direct-table access to Scorer accounts; permission is limited to RPC.
    const rights=await db.admin("select has_table_privilege('authenticated','fftt_private.player_departures_v1','select') can_select");
    assert.equal(rights[0].can_select,false);
  }finally{await w.close();await db.db.close();}
});
test('Real Staff Chrome: Organizer may mark withdrawal and return, Scorer never sees control', {timeout:240000},async()=>{
  const {w,db,E,current}=await world();
  try {
    const player=(await current()).players[0];
    const org=await w.device('org',{viewport:{width:390,height:844},mobile:true});
    const scorer=await w.device('a',{viewport:{width:390,height:844},mobile:true});
    await org.signIn('org',{keep:true});
    await scorer.signIn('a',{keep:true});
    assert.equal(await scorer.page.getByText('Player departures during play').count(),0);
    assert.equal(await scorer.page.locator('[data-tab]',{hasText:'Championship'}).count(),0);
    await org.page.locator('[data-tab]',{hasText:'Championship'}).first().click();
    const section=org.page.locator('section[aria-label="Player departures during play"]');
    await section.waitFor({timeout:T});
    await section.getByRole('button',{name:'Record event withdrawal…'}).click();
    const dlg=org.page.locator('dialog[open]');
    await dlg.locator('#departurePlayer').selectOption(player.id);
    await dlg.locator('#departureReason').selectOption('Unable to continue (injury)');
    await dlg.locator('#departureDetails').fill('Left the venue');
    await dlg.getByRole('button',{name:'Record withdrawal'}).click();
    await org.page.locator('section[aria-label="Player departures during play"]').getByText('Withdrawn',{exact:true}).waitFor({timeout:T});
    await section.getByRole('button',{name:'Mark returned…'}).click();
    await org.page.locator('dialog[open]').getByRole('button',{name:'Mark returned'}).click();
    await org.page.locator('section[aria-label="Player departures during play"]').getByText('Returned',{exact:true}).waitFor({timeout:T});
    assert.equal(await scorer.page.getByText('Player departures during play').count(),0);
    assert.deepEqual(w.pageErrors,[]);
  }finally{await w.close();await db.db.close();}
});
