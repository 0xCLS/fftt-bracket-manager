/** Optional owner-local test. The historical backup never leaves this process. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createLocalDb} from './localdb.mjs';
const path=process.env.FFTT_SHOWCASE_BACKUP;
const eid='e6bd40cf-4107-43ea-8c87-057dc38ef31b';
const sha='c16a477419af1f277792665a0e9ca94bd513effc66de1c7639dab51da84a0c44';
const query=async(tx,sql,params=[])=>tx.query(sql,params);

test('historical showcase: reset progress, final scores, stale writes and receipts', {skip:!path}, async()=>{
 const bytes=fs.readFileSync(path); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),sha);
 const data=JSON.parse(bytes); const rows=k=>data.tables[k].rows.filter(r=>r.event_id===eid);
 const event=data.tables.events.rows.find(r=>r.id===eid); assert.ok(event?.synthetic_only);
 const db=await createLocalDb();
 try {
  const org=await db.addUser('showcase-organizer@example.invalid',{platformOrganizer:true});
  const score=await db.addUser('showcase-scorer@example.invalid');
  const outsider=await db.addUser('unrelated-organizer@example.invalid',{platformOrganizer:true});
  event.created_by=org;
  const fixture={event,players:rows('players'),brackets:rows('brackets'),matches:rows('matches'),reviews:rows('consolation_reviews')};
  fixture.brackets.forEach(b=>b.created_by=org); fixture.reviews.forEach(r=>r.reviewed_by=org);
  fixture.matches.forEach(m=>m.game_progress_epoch=0);
  await db.db.transaction(async tx=>{
   await query(tx,'insert into fftt_private.events select (jsonb_populate_record(null::fftt_private.events,$1::jsonb)).*',[JSON.stringify(event)]);
   await query(tx,'insert into fftt_private.players select * from jsonb_populate_recordset(null::fftt_private.players,$1::jsonb)',[JSON.stringify(fixture.players)]);
   await query(tx,'insert into fftt_private.brackets select * from jsonb_populate_recordset(null::fftt_private.brackets,$1::jsonb)',[JSON.stringify(fixture.brackets)]);
   await query(tx,'insert into fftt_private.matches select * from jsonb_populate_recordset(null::fftt_private.matches,$1::jsonb)',[JSON.stringify(fixture.matches)]);
   await query(tx,'insert into fftt_private.consolation_reviews select * from jsonb_populate_recordset(null::fftt_private.consolation_reviews,$1::jsonb)',[JSON.stringify(fixture.reviews)]);
   await query(tx,"insert into fftt_private.event_staff(event_id,user_id,role) values ($1,$2,'organizer'),($1,$3,'scorekeeper')",[eid,org,score]);
   await query(tx,'update fftt_private.events set revision=revision+1 where id=$1',[eid]);
  });
  await db.db.exec(fs.readFileSync(new URL('../../supabase/migrations/20261108114950_showcase_reset.sql',import.meta.url),'utf8'));
  // Exercise the exact local installer fragment; never print its contents.
  await db.db.exec(fs.readFileSync(process.env.FFTT_SHOWCASE_INSTALLER,'utf8'));
  // The test identities are synthetic, so replace fixture reviewer references only inside this disposable database.
  await db.admin("update fftt_private.consolation_reviews set reviewed_by=null where event_id=$1",[eid]);
  const reset=(who,id=crypto.randomUUID())=>db.rpc(who,'fftt_reset_showcase_v1',{p_confirmation:'RESET SHOWCASE',p_request_id:id});
  await assert.rejects(reset(null)); await assert.rejects(reset(score)); await assert.rejects(reset(outsider));
  const originalPublic=(await db.publicTournaments())[0].brackets;
  const other=await db.rpc(outsider,'fftt_create_event_v3',{p_name:'Independent fixture',p_date:'2026-11-22',p_table_count:2});
  const otherBefore=await db.admin('select revision,lifecycle from fftt_private.events where id=$1',[other.event_id]);
  const desk=await db.rpc(score,'fftt_matchdesk_v2',{p_event_id:eid},{rows:true});
  const row=desk.find(m=>m.table_number===1); assert.ok(row);
  const read=()=>db.rpc(score,'fftt_game_progress_v1',{p_event_id:eid,p_match_id:row.match_id});
  const before=await read();
  const save=(shot,id)=>db.rpc(score,'fftt_save_completed_game_v1',{p_event_id:eid,p_match_id:row.match_id,p_generation:shot.generation,p_expected_match_version:shot.match_version,p_expected_epoch:shot.epoch,p_expected_progress_version:shot.revision,p_expected_best_of:shot.best_of,p_expected_points_to_win:shot.points_to_win,p_submission_id:id,p_game_index:1,p_player_1_score:11,p_player_2_score:7,p_reason:null});
  const saved=await save(before,crypto.randomUUID()); assert.equal(saved.status,'accepted');
  const request=crypto.randomUUID(); const first=await reset(org,request); assert.equal(first.status,'reset');
  assert.deepEqual(await reset(org,request),first); const after=await read(); assert.deepEqual(after.games,[]); assert.ok(after.epoch>before.epoch); assert.ok(after.match_version>before.match_version); assert.ok(after.revision>saved.revision);
  const stale=await save(before,crypto.randomUUID()); assert.equal(stale.status,'rejected');
  assert.ok((await reset(org)).revision>first.revision); assert.ok((await read()).revision>after.revision);
  // Complete a match through the real scoring path and verify its downstream slot advances.
  const fresh=await read(); const one=await save(fresh,crypto.randomUUID()); assert.equal(one.status,'accepted');
  const middle=await read();
  const two=await db.rpc(score,'fftt_save_completed_game_v1',{p_event_id:eid,p_match_id:row.match_id,p_generation:middle.generation,p_expected_match_version:middle.match_version,p_expected_epoch:middle.epoch,p_expected_progress_version:middle.revision,p_expected_best_of:middle.best_of,p_expected_points_to_win:middle.points_to_win,p_submission_id:crypto.randomUUID(),p_game_index:2,p_player_1_score:11,p_player_2_score:8,p_reason:null});
  assert.equal(two.status,'accepted');
  const result=await db.rpc(score,'fftt_submit_match_result_v2',{p_event_id:eid,p_match_id:row.match_id,p_bracket_generation:row.bracket_generation,p_expected_match_version:middle.match_version,p_submission_id:crypto.randomUUID(),p_winner_id:row.player_1_id,p_game_scores:'11-7, 11-8',p_table_number:1});
  assert.equal(result.status,'accepted');
  const advanced=await db.admin('select status,(select count(*) from fftt_private.matches n where n.event_id=m.event_id and n.id=m.next_match_id and (n.player_1_id=m.winner_id or n.player_2_id=m.winner_id))::int as advanced from fftt_private.matches m where m.event_id=$1 and m.id=$2',[eid,row.match_id]);
  assert.equal(advanced[0].status,'complete'); assert.equal(advanced[0].advanced,1);
  // A subsequent demo match can occupy the original table; restoration must still
  // release that assignment before restoring the baseline playing match.
  const available=(await db.rpc(score,'fftt_matchdesk_v2',{p_event_id:eid},{rows:true})).find(m=>m.match_id!==row.match_id && m.table_number===null && m.player_1_id && m.player_2_id);
  assert.ok(available,'another fictional match is ready');
  await db.rpc(org,'fftt_assign_table_v3',{p_event_id:eid,p_match_id:available.match_id,p_table_number:1});
  await reset(org);
  const staleResult=await db.rpc(score,'fftt_submit_match_result_v2',{p_event_id:eid,p_match_id:row.match_id,p_bracket_generation:row.bracket_generation,p_expected_match_version:middle.match_version,p_submission_id:crypto.randomUUID(),p_winner_id:row.player_1_id,p_game_scores:'11-7, 11-8',p_table_number:1});
  assert.equal(staleResult.status,'rejected');
  assert.ok((await read()).revision>middle.revision,'game revisions never rewind');
  const matches=await db.admin('select id,player_1_id,player_2_id,winner_id,game_scores,status,table_number from fftt_private.matches where event_id=$1',[eid]);
  const baseline=new Map(fixture.matches.map(m=>[m.id,m]));
  assert.ok(matches.every(m=>['player_1_id','player_2_id','winner_id','game_scores','status','table_number'].every(k=>m[k]===baseline.get(m.id)[k])),'original match presentation restored');
  const published=(await db.publicTournaments())[0];
  assert.ok(JSON.stringify(published.brackets)===JSON.stringify(originalPublic),'public projection restored');
  assert.ok(!/rating|email|actor_id|submission_id|player_1_id/i.test(JSON.stringify(published)),'public projection excludes private fields');
  const finalReceipts=await db.admin('select count(*)::int as n from fftt_private.score_decisions_v2 where event_id=$1',[eid]); assert.equal(finalReceipts[0].n,2);
  assert.deepEqual(await db.admin('select revision,lifecycle from fftt_private.events where id=$1',[other.event_id]),otherBefore);

  const preserved=await db.admin('select (select count(*)::int from fftt_private.game_progress_decisions where event_id=$1) as receipts,(select count(*)::int from fftt_private.audit_events where event_id=$1 and operation=$2) as resets',[eid,'showcase_reset']);
  assert.equal(preserved[0].receipts,4); assert.equal(preserved[0].resets,3);
 } finally {await db.db.close();}
});
