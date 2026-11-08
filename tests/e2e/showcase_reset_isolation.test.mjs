import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupEvent,buildChampionship,deskOf} from './helpers.mjs';

test('V6 scoring on an unrelated fictional event is unchanged after installing reset SQL',async()=>{
 const ctx=await setupEvent({players:8,tables:2});
 try{
  await buildChampionship(ctx);
  await ctx.db.db.exec(fs.readFileSync(new URL('../../supabase/migrations/20261108114950_showcase_reset.sql',import.meta.url),'utf8'));
  const row=(await deskOf(ctx,ctx.skA))[0];
  await ctx.db.rpc(ctx.org,'fftt_assign_table_v3',{p_event_id:ctx.E,p_match_id:row.match_id,p_table_number:1});
  const shot=await ctx.db.rpc(ctx.skA,'fftt_game_progress_v1',{p_event_id:ctx.E,p_match_id:row.match_id});
  assert.equal(shot.revision,0);
  const save=await ctx.db.rpc(ctx.skA,'fftt_save_completed_game_v1',{p_event_id:ctx.E,p_match_id:row.match_id,p_generation:shot.generation,p_expected_match_version:shot.match_version,p_expected_epoch:shot.epoch,p_expected_progress_version:shot.revision,p_expected_best_of:shot.best_of,p_expected_points_to_win:shot.points_to_win,p_submission_id:crypto.randomUUID(),p_game_index:1,p_player_1_score:11,p_player_2_score:7,p_reason:null});
  assert.equal(save.status,'accepted'); assert.equal(save.revision,1);
  assert.equal((await ctx.db.admin('select count(*)::int as n from fftt_private.showcase_progress_watermarks'))[0].n,0);
 } finally {await ctx.db.db.close();}
});
