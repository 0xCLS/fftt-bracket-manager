import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('manager-only event-day UI has private-source-free check-in and closeout',()=>{
 const ui=read('app/staff_ui.mjs');
 const api=read('contracts/gameday_api.mjs');
 const core=read('app/staff_core.mjs');
 assert.match(ui,/BRACKET_MANAGER_TABS = \[\['checkin'/);
 assert.match(ui,/\['wrap', 'Finish'\]/);
 assert.match(ui,/function viewManagerCheckin\(\)/);
 assert.match(ui,/function viewManagerWrap\(\)/);
 assert.match(ui,/if \(!isBracketManager\(\)\) return loading\(\)/);
 assert.match(ui,/const canAdjudicate = org \|\| isBracketManager\(\)/);
 assert.match(ui,/Recent results and corrections/);
 assert.match(ui,/No-show…/);
 assert.match(ui,/Mark event complete/);
 assert.match(api,/fftt_event_day_walkin_v1/);
 assert.match(core,/eventDayWalkIn: \(name, rating\) => s.role === 'bracket_manager'/);
 const managerScreen=ui.slice(ui.indexOf('function viewManagerCheckin()'),ui.indexOf('function viewChampionship()'));
 assert.doesNotMatch(managerScreen,/registrationClient|registrationSettings|loadRegistrations|registrationRefs/);
});

test('event-day SQL candidate retains privileged boundaries',()=>{
 const sql=read('supabase/proposals/FFTT3_EVENT_DAY_DELEGATION_20261105_DO_NOT_APPLY.sql');
 for(const fn of ['set_checkin_v3','forfeit_match_v3','correct_result_v3','set_match_format_v4','set_lifecycle_v3'])
   assert.match(sql,new RegExp('create or replace function fftt_private\\.'+fn+'\\('));
 assert.match(sql,/bracket-locked/);
 assert.match(sql,/v_event\.lifecycle <> 'active'/);
 assert.match(sql,/p_lifecycle is distinct from 'complete'/);
 assert.match(sql,/array\['bracket_manager'\]/);
 assert.match(sql,/rating_confirmed\)/);
 assert.match(sql,/registration_checkin/);
 for(const forbidden of ['set_visibility_v3','set_staff_v3','set_registration_source_v5','delete_event_v4','restore_event_v4'])
   assert.ok(!sql.includes('function fftt_private.'+forbidden+'('),'cannot broaden '+forbidden);
 assert.match(sql,/DO NOT APPLY TO HOSTED SUPABASE/);
 assert.match(sql,/grant execute on function public\.fftt_event_day_walkin_v1\(uuid,text,integer\) to authenticated/);
 assert.match(sql,/p_lifecycle is distinct from 'complete'/);
 assert.match(sql,/v_event\.lifecycle <> 'active'/);
});
