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
 // the desk reads registrations ONLY through the reduced lookup; never the Organizer's settings, source, CSV tools or roster references
 assert.match(managerScreen,/deskRegistrationCard\(sn, \{eligible\}\)/);
 assert.doesNotMatch(managerScreen,/registrationClient|registrationSettings|loadRegistrations|registrationRefs|importRegistrationsCsv|registrationSource/);
 const lookup=read('app/view_desk_registration.mjs');
 assert.doesNotMatch(lookup,/registrationSettings|loadRegistrations\b|registrationRefs|importRegistrationsCsv|registrationSource|setRegistrationSource|hint|shortName|innerHTML/);
 assert.match(lookup,/core\.actions\.checkinRegistration/);
 assert.match(core,/checkinRegistration\(\{ref, mergeRefs = \[\], level = null, linkPlayerId = null\} = \{\}\)/);
 assert.match(core,/if \(s\.role !== 'bracket_manager' \|\| !s\.eventId\) return \{ok: false, message: DESK_ERRORS\.forbidden/);
 // the Organizer's registration actions stay Organizer-only
 assert.match(core,/async loadRegistrations\(\) \{[\s\S]*?if \(ctx\.role !== 'organizer'\) throw new RegistrationClientError\('forbidden'\)/);
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

test('desk registration SQL candidate: proof-gated, Bracket-Manager-only, no source or Organizer widening',()=>{
 const sql=read('supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql');
 const rollback=read('supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_ROLLBACK_DO_NOT_APPLY.sql');
 assert.match(sql,/DO NOT APPLY TO HOSTED SUPABASE/);
 assert.match(rollback,/DO NOT APPLY TO HOSTED SUPABASE/);
 assert.match(sql,/v3_begin\(p_event_id, array\['bracket_manager'\], array\['draft','active'\]\)/);
 assert.match(sql,/registration_gate_ok\('checkin'/);
 assert.match(sql,/registration_gate_ok\('lookup'/);
 assert.match(sql,/bracket-locked/); assert.match(sql,/source-changed/); assert.match(sql,/source-not-enabled/); assert.match(sql,/link-name-mismatch/);
 // nothing existing is replaced or widened
 assert.doesNotMatch(sql,/create or replace function/i);
 assert.doesNotMatch(sql,/array\['organizer'/);
 for(const forbiddenFn of ['registration_source_v5','set_registration_source_v5','checkin_registrants_v4','set_staff_v3','set_visibility_v3','delete_event_v4'])
   assert.ok(!sql.includes('function fftt_private.'+forbiddenFn+'('),'does not redefine '+forbiddenFn);
 // every definer function pins search_path; helpers are not executable by API roles; only the two wrappers are
 assert.equal((sql.match(/security definer set search_path = ''/g)??[]).length,5);
 assert.match(sql,/revoke all on function fftt_private\.install_registration_gate_v1\(text\) from public, anon, authenticated/);
 assert.match(sql,/grant execute on function public\.fftt_bm_registration_lookup_v1\(uuid,bigint,text\) to authenticated/);
 assert.match(sql,/grant execute on function public\.fftt_bm_registration_checkin_v1\(uuid,jsonb,text,bigint,text\) to authenticated/);
 assert.ok(!/grant execute on function fftt_private\.(install_registration_gate_v1|hmac_sha256_hex|registration_gate_ok|registration_source_fp)/.test(sql));
 assert.ok(!/(service_role_key|eyJ[A-Za-z0-9_-]{20,}|gate_secret\s*=\s*')/.test(sql),'no secret value in the file');
 for(const fn of ['fftt_bm_registration_checkin_v1','fftt_bm_registration_lookup_v1','bm_registration_checkin_v1','bm_registration_lookup_v1','registration_source_fp','registration_gate_ok','hmac_sha256_hex','install_registration_gate_v1'])
   assert.match(rollback,new RegExp('drop function if exists [a-z_.]*'+fn+'\\('));
 assert.match(rollback,/drop table if exists fftt_private\.registration_gate/);
});
