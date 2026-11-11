/** #79 event-level departure / return: disposable SQL and fictional browser only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserWorld} from './browser_world.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';
import {parsePlayerDepartures} from '../../contracts/gameday_api.mjs';

const SQL=fs.readFileSync(new URL('../../supabase/proposals/FFTT3_POSTSTART_DEPARTURES_20261110_DO_NOT_APPLY.sql',import.meta.url),'utf8');
const ROLLBACK_SQL=fs.readFileSync(new URL('../../supabase/proposals/FFTT3_POSTSTART_DEPARTURES_ACCESS_ROLLBACK_20261110_DO_NOT_APPLY.sql',import.meta.url),'utf8');
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
test('Departure response validates an exact mid-match saved-game snapshot',()=>{
  const e='00000000-0000-4000-8000-000000000001',m='00000000-0000-4000-8000-000000000002';
  const p={player_id:e,withdrawn:true,reason:'Unable to continue (injury)',
    recorded_at:'2099-11-12T13:00:00Z',returned_at:null,return_reason:null,
    interrupted_match_id:m,saved_games_at_departure:1};
  assert.equal(parsePlayerDepartures({event_id:e,revision:2,players:[p]}).players[0].savedGamesAtDeparture,1);
  assert.throws(()=>parsePlayerDepartures({event_id:e,revision:2,players:[{...p,interrupted_match_id:null}]}));
  assert.throws(()=>parsePlayerDepartures({event_id:e,revision:2,players:[{...p,saved_games_at_departure:0}]}));
  assert.throws(()=>parsePlayerDepartures({event_id:e,revision:2,players:[{...p,saved_games_at_departure:6}]}));
});

test('Injury retirement after saved Game 1 keeps the match pending, preserves scores, and records its match', {timeout:240000},async()=>{
  const {w,db,E,current,read,set}=await world();
  try {
    const desk=await db.rpc(w.ids.a,'fftt_matchdesk_v2',{p_event_id:E},{rows:true});
    const m=desk.find(x=>x.player_1_id && x.player_2_id);
    assert.ok(m);
    await db.rpc(w.ids.org,'fftt_assign_table_v3',{p_event_id:E,p_match_id:m.match_id,p_table_number:1});
    const before=await db.rpc(w.ids.a,'fftt_game_progress_v1',{p_event_id:E,p_match_id:m.match_id});
    const saved=await db.rpc(w.ids.a,'fftt_save_completed_game_v1',{
      p_event_id:E,p_match_id:m.match_id,p_generation:before.generation,
      p_expected_match_version:before.match_version,p_expected_epoch:before.epoch,
      p_expected_progress_version:before.revision,p_expected_best_of:before.best_of,
      p_expected_points_to_win:before.points_to_win,p_submission_id:crypto.randomUUID(),
      p_game_index:1,p_player_1_score:before.points_to_win,p_player_2_score:7,p_reason:null});
    assert.equal(saved.status,'accepted');
    const original=await db.rpc(w.ids.a,'fftt_game_progress_v1',{p_event_id:E,p_match_id:m.match_id});
    assert.equal(original.games.length,1);
    assert.equal((await set(w.ids.bm,m.player_2_id,'withdrawn','Unable to continue (injury)')).status,'updated');
    const ledger=(await read(w.ids.org)).players.find(x=>x.player_id===m.player_2_id);
    assert.equal(ledger.interrupted_match_id,m.match_id);
    assert.equal(ledger.saved_games_at_departure,1);
    const match=(await current()).matches.find(x=>x.id===m.match_id);
    assert.equal(match.status,'pending','no automatic winner or fake result');
    assert.deepEqual((await db.rpc(w.ids.a,'fftt_game_progress_v1',{p_event_id:E,p_match_id:m.match_id})).games,
      original.games,'saved game is never deleted');
    const audit=await db.admin("SELECT after_state FROM fftt_private.audit_events WHERE event_id=$1 AND operation='player_departure_changed' ORDER BY event_revision DESC LIMIT 1",[E]);
    assert.equal(audit[0].after_state.interrupted_match_id,m.match_id);
    assert.equal(audit[0].after_state.saved_games_at_departure,1);
    const newer=await db.rpc(w.ids.a,'fftt_save_completed_game_v1',{
      p_event_id:E,p_match_id:m.match_id,p_generation:original.generation,
      p_expected_match_version:original.match_version,p_expected_epoch:original.epoch,
      p_expected_progress_version:original.revision,p_expected_best_of:original.best_of,
      p_expected_points_to_win:original.points_to_win,p_submission_id:crypto.randomUUID(),
      p_game_index:2,p_player_1_score:original.points_to_win,p_player_2_score:7,p_reason:null
    }).then(()=>null,e=>e);
    assert.ok(newer,'a new game is held during retirement');
    assert.equal((await set(w.ids.org,m.player_2_id,'returned','Player returned to finish play')).status,'updated');
    assert.equal((await read(w.ids.bm)).players[0].saved_games_at_departure,1,'the historical interruption persists');
    assert.deepEqual((await db.rpc(w.ids.a,'fftt_game_progress_v1',{p_event_id:E,p_match_id:m.match_id})).games,original.games);
  }finally{await w.close();await db.db.close();}
});

test('Emergency rollback restores five exact score functions, disables only new RPCs and keeps saved data', {timeout:240000},async()=>{
  const {w,db,E,current,read,set}=await world();
  try {
    const desk=await db.rpc(w.ids.a,'fftt_matchdesk_v2',{p_event_id:E},{rows:true});
    const m=desk.find(x=>x.player_1_id&&x.player_2_id);
    assert.ok(m);
    await db.rpc(w.ids.org,'fftt_assign_table_v3',{p_event_id:E,p_match_id:m.match_id,p_table_number:1});
    assert.equal((await set(w.ids.org,m.player_2_id,'withdrawn','Left tournament early')).status,'updated');
    const ledgerBefore=await read(w.ids.org);
    assert.equal(ledgerBefore.players.length,1);
    const backups=await db.admin('SELECT signature,original_md5,guarded_md5 FROM fftt_private.departure_guard_restore_v1');
    assert.equal(backups.length,5);
    assert.ok(backups.every(x=>x.original_md5!==x.guarded_md5));
    await db.db.exec(ROLLBACK_SQL);
    await assert.rejects(read(w.ids.org),'private departure RPC is revoked');
    await assert.rejects(set(w.ids.org,m.player_2_id,'returned','Returned'),'write RPC is revoked');
    const backupAfter=await db.admin('SELECT signature FROM fftt_private.departure_guard_restore_v1');
    assert.equal(backupAfter.length,5,'original score sources remain in evidence ledger');
    const savedLedger=await db.admin('SELECT player_id,withdrawn FROM fftt_private.player_departures_v1 WHERE event_id=$1',[E]);
    assert.equal(savedLedger.length,1,'departure history preserved');
    assert.equal(savedLedger[0].withdrawn,true);
    const snap=await current();
    const result=await db.rpc(w.ids.a,'fftt_submit_match_result_v2',{
      p_event_id:E,p_match_id:m.match_id,p_bracket_generation:snap.event.generation,
      p_expected_match_version:m.match_version,p_submission_id:crypto.randomUUID(),
      p_winner_id:m.player_1_id,p_game_scores:'11-7, 11-8',p_table_number:1});
    assert.equal(result.status,'accepted','the previous scoring functions are working after rollback');
    assert.equal((await current()).matches.find(x=>x.id===m.match_id).status,'complete');
  }finally{await w.close();await db.db.close();}
});

test('Role guards, revision guard, departure/return audit, no score or bracket rewrite', {timeout:240000},async()=>{
  const {w,db,E,current,read,set}=await world();
  try {
    // Record an actual fictional W/O first. The later event-level return
    // must never turn this accepted result back into a pending match.
    const ready=await db.rpc(w.ids.org,'fftt_matchdesk_v2',{p_event_id:E},{rows:true});
    const match=ready.find(m=>m.player_1_id&&m.player_2_id);
    assert.ok(match);
    const player=match.player_2_id;
    const wo=await db.rpc(w.ids.org,'fftt_forfeit_match_v3',{
      p_event_id:E,p_match_id:match.match_id,p_expected_match_version:match.match_version,
      p_absent_player_id:player,p_reason:'Unable to continue (injury)'});
    assert.equal(wo.status,'accepted');
    const before=await current();
    assert.equal(before.matches.find(m=>m.id===match.match_id).game_scores,'W/O');
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
    assert.equal(after.matches.find(m=>m.id===match.match_id).game_scores,'W/O','return does not undo accepted walkover');
    const audits=await db.admin("select operation,reason,event_revision from fftt_private.audit_events where event_id=$1 and operation='player_departure_changed' order by event_revision",[E]);
    assert.deepEqual(audits.map(x=>x.reason),['Unable to continue (injury)','Player returned to venue','Left tournament early']);
    assert.deepEqual(audits.map(x=>x.operation),['player_departure_changed','player_departure_changed','player_departure_changed']);
    // No opaque direct-table access to Scorer accounts; permission is limited to RPC.
    const rights=await db.admin("select has_table_privilege('authenticated','fftt_private.player_departures_v1','select') can_select");
    assert.equal(rights[0].can_select,false);
  }finally{await w.close();await db.db.close();}
});
test('Active withdrawal blocks new singles scores and saved games without changing accepted W/O', {timeout:240000}, async()=>{
  const {w,db,E,current,set}=await world();
  try {
    const rows=await db.rpc(w.ids.a,'fftt_matchdesk_v2',{p_event_id:E},{rows:true});
    const row=rows.find(r=>r.player_1_id && r.player_2_id);
    assert.ok(row,'there must be a ready two-player singles match');
    const absent=row.player_2_id;
    await db.rpc(w.ids.org,'fftt_assign_table_v3',{p_event_id:E,p_match_id:row.match_id,p_table_number:1});
    const before=await current();
    assert.equal((await set(w.ids.bm,absent,'withdrawn','Left tournament early')).status,'updated');
    const params={p_event_id:E,p_match_id:row.match_id,p_bracket_generation:before.event.generation,
      p_expected_match_version:row.match_version,p_submission_id:crypto.randomUUID(),
      p_winner_id:row.player_1_id,p_game_scores:'11-7, 11-8',p_table_number:1};
    await assert.rejects(db.rpc(w.ids.a,'fftt_submit_match_result_v2',params),
      err=>err.code==='P0001' && err.message==='fftt_conflict' && err.detail==='player-withdrawn');
    const progress=await db.rpc(w.ids.a,'fftt_game_progress_v1',{p_event_id:E,p_match_id:row.match_id});
    await assert.rejects(db.rpc(w.ids.a,'fftt_save_completed_game_v1',{
      p_event_id:E,p_match_id:row.match_id,p_generation:before.event.generation,
      p_expected_match_version:row.match_version,p_expected_epoch:progress.epoch,
      p_expected_progress_version:progress.revision,p_expected_best_of:progress.best_of,
      p_expected_points_to_win:progress.points_to_win,p_submission_id:crypto.randomUUID(),
      p_game_index:1,p_player_1_score:11,p_player_2_score:7,p_reason:null}),
      err=>err.code==='P0001' && err.message==='fftt_conflict' && err.detail==='player-withdrawn');
    const frozen=await current();
    assert.equal(frozen.matches.find(m=>m.id===row.match_id).status,'pending');
    assert.deepEqual((await db.rpc(w.ids.a,'fftt_game_progress_v1',{p_event_id:E,p_match_id:row.match_id})).games,[]);
    // The already authorized no-show remains the ONLY way to advance a withdrawal.
    // It must still work despite the status guard and preserve a W/O result.
    const currentDesk=await db.rpc(w.ids.org,'fftt_matchdesk_v2',{p_event_id:E},{rows:true});
    const now=currentDesk.find(m=>m.match_id===row.match_id);
    assert.equal((await db.rpc(w.ids.bm,'fftt_forfeit_match_v3',{
      p_event_id:E,p_match_id:now.match_id,p_expected_match_version:now.match_version,
      p_absent_player_id:absent,p_reason:'Left tournament early'})).status,'accepted');
    const after=await current();
    assert.equal(after.matches.find(m=>m.id===row.match_id).game_scores,'W/O');
    const stale=await db.rpc(w.ids.a,'fftt_submit_match_result_v2', {...params,p_submission_id:crypto.randomUUID()});
    assert.equal(stale.status,'rejected','a finalized walkover rejects a later attempt to score');
    assert.equal(stale.reason,'stale-match-version');
    assert.equal((await set(w.ids.org,absent,'returned','Player returned to venue')).status,'updated');
    assert.equal((await current()).matches.find(m=>m.id===row.match_id).game_scores,'W/O');
    assert.deepEqual(w.pageErrors,[]);
  } finally {await w.close();await db.db.close();}
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

test('fictional Scorer sees the actual withdrawal refusal, keeps saved game and can score another match', {timeout:240000},async()=>{
  const {w,db,E,set}=await world();
  try {
    const rows=await db.rpc(w.ids.a,'fftt_matchdesk_v2',{p_event_id:E},{rows:true});
    const [m,other]=rows.filter(x=>x.player_1_id&&x.player_2_id);
    await db.rpc(w.ids.org,'fftt_assign_table_v3',{p_event_id:E,p_match_id:m.match_id,p_table_number:1});
    await db.rpc(w.ids.org,'fftt_assign_table_v3',{p_event_id:E,p_match_id:other.match_id,p_table_number:2});
    const scorer=await w.device('a',{viewport:{width:390,height:844},mobile:true}); await scorer.signIn('a');
    const open=async name=>{await scorer.page.locator('.queue-card',{hasText:name}).getByRole('button',{name:'Record result'}).click(); return scorer.page.locator('dialog[open]');};
    let dlg=await open(m.player_1_name);
    await dlg.getByText('Game 1 · Unconfirmed').waitFor({timeout:T});
    let input=dlg.locator('.games input');
    await input.nth(0).fill('11'); await input.nth(1).fill('7'); await dlg.getByRole('button',{name:'Save Game 1'}).click();
    await dlg.getByText('Game 1 · 11–7 · Saved').waitFor({timeout:T});
    assert.equal((await set(w.ids.org,m.player_2_id,'withdrawn','Unable to continue (injury)')).status,'updated');
    input=dlg.locator('.games input'); await input.nth(2).fill('11'); await input.nth(3).fill('8');
    await dlg.getByRole('button',{name:'Save Game 2'}).click();
    await dlg.getByText(/No game was saved because a participating player is recorded as withdrawn/).waitFor({timeout:T});
    assert.equal(await scorer.page.getByText('No server decision yet',{exact:false}).count(),0);
    assert.deepEqual((await db.rpc(w.ids.a,'fftt_game_progress_v1',{p_event_id:E,p_match_id:m.match_id})).games,[[11,7]]);
    await dlg.getByRole('button',{name:'Close',exact:true}).last().click();
    assert.equal(await scorer.page.getByText('Unconfirmed save',{exact:false}).count(),0);
    dlg=await open(other.player_1_name);
    await dlg.getByText('Game 1 · Unconfirmed').waitFor({timeout:T});
    input=dlg.locator('.games input');
    await input.nth(0).fill('11'); await input.nth(1).fill('6'); await dlg.getByRole('button',{name:'Save Game 1'}).click();
    await dlg.getByText('Game 1 · 11–6 · Saved').waitFor({timeout:T});
    assert.deepEqual((await db.rpc(w.ids.a,'fftt_game_progress_v1',{p_event_id:E,p_match_id:other.match_id})).games,[[11,6]]);
  } finally {await w.close(); await db.db.close();}
});
