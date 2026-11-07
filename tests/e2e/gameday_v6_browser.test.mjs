/** Fictional Playwright mobile scorekeeping end-to-end through real Staff, V6 SQL and public TV. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserWorld, SPECT} from './browser_world.mjs';
import {seedSlots, enginePlayers} from '../../contracts/gameday_engine.mjs';

const PHONE={viewport:{width:390,height:844},mobile:true};
const TIMEOUT=30000;
const nextSaved=async (dlg, number, scores, tally) => {
  const input=dlg.locator('.games input');
  await input.nth((number-1)*2).fill(String(scores[0]));
  await input.nth((number-1)*2+1).fill(String(scores[1]));
  await dlg.locator('button',{hasText:`Save Game ${number}`}).click();
  try {
    await dlg.locator('.game-step',{hasText:new RegExp(`Game ${number} · ${scores[0]}–${scores[1]} · Saved`)}).waitFor({timeout:12000});
  } catch (error) {
    throw new Error(`Save Game ${number} lacked verified Saved state: ${(await dlg.innerText()).slice(0,2500)}`,{cause:error});
  }
  await dlg.locator('.game-tally',{hasText:`Games won · ${tally}`}).waitFor({timeout:TIMEOUT});
};

test('mobile Scorekeeper saves G1/G2/G3, TV shows only confirmed progress; final alone advances', {timeout:180000},async()=>{
  const w=await createBrowserWorld({players:8}), db=w.fake.local,E=w.eventId;
  try{
    await db.rpc(w.ids.org,'fftt_set_checkin_bulk_v3',{p_event_id:E,p_player_ids:null,p_checked_in:true});
    const snap=await db.rpc(w.ids.org,'fftt_organizer_snapshot_v3',{p_event_id:E});
    await db.rpc(w.ids.org,'fftt_build_championship_v3',{
      p_event_id:E,p_slots:seedSlots(enginePlayers(snap.players)),
      p_expected_generation:0,p_confirm:false});
    const [row]=(await db.rpc(w.ids.org,'fftt_matchdesk_v2',{p_event_id:E},{rows:true}));
    assert.ok(row?.match_id,'fictional playable match');
    await db.rpc(w.ids.org,'fftt_assign_table_v3',{p_event_id:E,p_match_id:row.match_id,p_table_number:1});
    await db.rpc(w.ids.org,'fftt_set_visibility_v3',{p_event_id:E,p_visible:true});
    const a=await w.device('a',PHONE);
    await a.signIn('a');
    const card=a.page.locator('.queue-card',{hasText:row.player_1_name}).first();
    await card.waitFor({timeout:TIMEOUT});
    await card.getByRole('button',{name:'Record result'}).click();
    const dlg=a.page.locator('dialog[open]');
    await dlg.locator('.game-step',{hasText:'Game 1 · Unconfirmed'}).waitFor({timeout:TIMEOUT});
    await nextSaved(dlg,1,[11,7],'1–0');
    const stillPending=await db.admin('select status, game_scores from fftt_private.matches where id=$1',[row.match_id]);
    assert.equal(stillPending[0].status,'pending','Game 1 does not declare a winner');
    assert.equal(stillPending[0].game_scores,'');
    await nextSaved(dlg,2,[8,11],'1–1');
    const tv=await w.device('tv',{viewport:{width:1280,height:720}});
    await tv.open(SPECT+'/app/tv.html');
    const progress=tv.page.locator('.table-card.active .live-game-progress');
    await progress.locator('strong',{hasText:'1–1'}).waitFor({timeout:TIMEOUT});
    assert.match(await progress.innerText(),/G1 11–7.*G2 8–11/);
    assert.equal((await db.admin('select status from fftt_private.matches where id=$1',[row.match_id]))[0].status,'pending');
    await nextSaved(dlg,3,[11,9],'2–1');
    await dlg.locator('.game-tally',{hasText:'official result not yet confirmed'}).waitFor({timeout:TIMEOUT});
    await dlg.getByRole('button',{name:'Review result'}).click();
    await dlg.locator('.review',{hasText:'11-7, 8-11, 11-9'}).waitFor({timeout:TIMEOUT});
    assert.equal((await db.admin('select status from fftt_private.matches where id=$1',[row.match_id]))[0].status,'pending');
    await dlg.getByRole('button',{name:'Confirm and send'}).click();
    await dlg.waitFor({state:'detached',timeout:TIMEOUT});
    const complete=await db.admin('select status,game_scores from fftt_private.matches where id=$1',[row.match_id]);
    assert.equal(complete[0].status,'complete');
    assert.equal(complete[0].game_scores,'11-7, 8-11, 11-9');
    const pub=JSON.parse(JSON.stringify(await db.publicTournaments()));
    const m=pub[0].brackets.flatMap(b=>b.matches).find(m=>m.game_scores==='11-7, 8-11, 11-9');
    assert.ok(m);
    assert.equal(m.game_progress,null,'only the official result remains published');
    assert.equal(JSON.stringify(pub).includes('email'),false);
    assert.deepEqual(w.pageErrors,[]);
  }finally{await w.close(); await db.db.close();}
});
