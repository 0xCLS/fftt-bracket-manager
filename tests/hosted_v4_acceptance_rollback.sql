-- Hosted V4 SYNTHETIC acceptance script (October 26, 2026). Run in the SQL editor of the SYNTHETIC project
-- (fftt-bracket-manager-dev) AFTER GAMEDAY_TOURNAMENT_V4_STAGING.sql. It is READ-ONLY IN EFFECT: it acts, inside ONE
-- transaction, as the existing platform organizer and an existing scorekeeper (role + JWT-claim switching, no passwords,
-- no accounts created), exercises V4 on clearly named disposable fictional events, and ALWAYS ends by raising an
-- exception carrying the report, so the whole transaction rolls back and nothing persists. Verify afterwards that the
-- event, audit, tombstone and grant counts are unchanged. Result 2026-10-26: PASSED=45 FAILED=0, zero residue.
begin;
create function pg_temp.as_q(p_uid uuid, p_sql text, p_anon boolean default false) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', case when p_anon then '{"role":"anon"}' else json_build_object('sub',p_uid,'role','authenticated','aud','authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
  execute case when p_anon then 'set local role anon' else 'set local role authenticated' end;
  execute p_sql into r;
  execute 'reset role';
  return r;
exception when others then
  execute 'reset role';
  raise;
end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text, p_anon boolean default false) returns text language plpgsql as $f$
declare d text;
begin
  perform pg_temp.as_q(p_uid, p_sql, p_anon);
  return 'OK';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return sqlstate || '/' || sqlerrm || '/' || coalesce(d,'');
end $f$;
create function pg_temp.ck(p_label text, p_ok boolean) returns text language sql as $f$ select E'\n' || case when coalesce(p_ok,false) then 'PASS ' else 'FAIL ' end || p_label $f$;
do $acc$
declare
  org uuid; sk uuid; rep text := ''; t text; r jsonb; snap jsonb; rows jsonb; regs jsonb; slots jsonb;
  E uuid; E2 uuid; E3 uuid; E4 uuid; row0 jsonb; row1 jsonb; row2 jsonb; mid uuid; ev_before int; stamp_n int; pub jsonb; skmail text;
begin
  select user_id into org from fftt_private.platform_organizers limit 1;
  select s.user_id into sk from fftt_private.event_staff s where s.role = 'scorekeeper' and s.active and s.user_id <> org limit 1;
  select email into skmail from auth.users where id = sk;
  select count(*) into ev_before from fftt_private.events;
  rep := rep || pg_temp.ck('actors found (platform organizer, scorekeeper)', org is not null and sk is not null);

  -- ===== E: Bo1/Bo3, 11/21, formats, registration check-in, scoring, conflicts, privacy
  r := pg_temp.as_q(org, $q$select public.fftt_create_event_v3('V4 ACCEPTANCE DISPOSABLE (fictional, rolled back)','2026-12-31',3)$q$);
  E := (r->>'event_id')::uuid;
  rep := rep || pg_temp.ck('organizer created a disposable draft event', E is not null);
  rep := rep || pg_temp.ck('new event is deletable and listed by name', (select (x->>'deletable')::boolean from jsonb_array_elements(pg_temp.as_q(org,'select public.fftt_my_events_v4()')) x where (x->>'event_id')::uuid = E));
  perform pg_temp.as_q(org, format($q$select public.fftt_set_staff_v3(%L,%L,'grant','scorekeeper')$q$, E, skmail));
  t := pg_temp.try_as(org, format($q$select public.fftt_set_formats_v4(%L,'{"champ":{"best_of":5,"points":11}}'::jsonb)$q$, E));
  rep := rep || pg_temp.ck('Best of 5 refused for new configuration ('||left(t,40)||')', t like '22023%');
  t := pg_temp.try_as(org, format($q$select public.fftt_set_formats_v4(%L,'{"champ":{"best_of":3,"points":15}}'::jsonb)$q$, E));
  rep := rep || pg_temp.ck('15-point games refused', t like '22023%');
  r := pg_temp.as_q(org, format($q$select public.fftt_set_formats_v4(%L,'{"champ":{"best_of":1,"points":21}}'::jsonb)$q$, E));
  rep := rep || pg_temp.ck('championship set to Best of 1 / 21 points', r->>'status' = 'updated');
  t := pg_temp.try_as(sk, format($q$select public.fftt_set_formats_v4(%L,'{"champ":{"best_of":3,"points":11}}'::jsonb)$q$, E));
  rep := rep || pg_temp.ck('scorekeeper cannot change formats', t like '42501%');
  t := pg_temp.try_as(null, format($q$select public.fftt_set_formats_v4(%L,'{"champ":{"best_of":3,"points":11}}'::jsonb)$q$, E), true);
  rep := rep || pg_temp.ck('anonymous cannot call V4 functions', t like '42501%');

  select jsonb_agg(jsonb_build_object('ref','ACCEPTREF'||lpad(g::text,11,'0'),'name','Accept Player '||chr(64+g),'rating',1+g%5,'rating_status','provisional','source','registration')) into regs from generate_series(1,8) g;
  r := pg_temp.as_q(org, format($q$select public.fftt_checkin_registrants_v4(%L,%L::jsonb,true)$q$, E, regs::text));
  rep := rep || pg_temp.ck('fictional registration check-in: 8 created and checked in', (r->>'created')::int = 8 and (r->>'changed')::int = 8);
  r := pg_temp.as_q(org, format($q$select public.fftt_checkin_registrants_v4(%L,%L::jsonb,true)$q$, E,
     '[{"ref":"ACCEPTREF00000000099","name":"Accept Player A","rating":3,"source":"registration","same_as_ref":"ACCEPTREF00000000001"}]'));
  rep := rep || pg_temp.ck('duplicate registration merged into the same player (nothing created)', (r->>'created')::int = 0 and (r->>'linked')::int = 1);
  t := pg_temp.try_as(org, format($q$select public.fftt_checkin_registrants_v4(%L,%L::jsonb,true)$q$, E, '[{"ref":"ACCEPTREF00000000050","name":"someone@example.invalid","rating":3,"source":"registration"}]'));
  rep := rep || pg_temp.ck('a name that is an e-mail address is refused', t like '22023%');
  snap := pg_temp.as_q(org, format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, E));
  rep := rep || pg_temp.ck('registered ratings are suggested (unconfirmed) until the organizer confirms', (select bool_and(not (p->>'rating_confirmed')::boolean) from jsonb_array_elements(snap->'players') p));
  r := pg_temp.as_q(org, format($q$select public.fftt_confirm_ratings_v4(%L,%L::jsonb)$q$, E, (select jsonb_agg(jsonb_build_object('id', p->>'id', 'rating', (p->>'rating')::int))::text from jsonb_array_elements(snap->'players') p)));
  rep := rep || pg_temp.ck('organizer confirmed the ratings', (r->>'changed')::int = 8);
  select jsonb_agg(p->>'id' order by p->>'name') into slots from jsonb_array_elements(snap->'players') p;
  r := pg_temp.as_q(org, format($q$select public.fftt_build_championship_v3(%L,%L::jsonb,0,false)$q$, E, slots::text));
  rep := rep || pg_temp.ck('championship built by the server', r->>'status' = 'built');
  rows := pg_temp.as_q(sk, format($q$select jsonb_agg(to_jsonb(t) order by t.slot) from public.fftt_matchdesk_v2(%L) t$q$, E));
  row0 := rows->0; row1 := rows->1; row2 := rows->2;
  rep := rep || pg_temp.ck('Match Desk shows Best of 1 / 21 for every opening match', jsonb_array_length(rows) = 4 and (select bool_and((x->>'best_of')::int = 1 and (x->>'points_to_win')::int = 21) from jsonb_array_elements(rows) x));
  for t in select unnest(array['11-5','21-20','23-20','21-15, 21-10','20-22']) loop
    rep := rep || pg_temp.ck('Bo1/21 refuses "'||t||'"', pg_temp.try_as(sk, format($q$select public.fftt_submit_match_result_v2(%L,%L,%s,%s,gen_random_uuid(),%L,%L,1)$q$, E, row0->>'match_id', row0->>'bracket_generation', row0->>'match_version', row0->>'player_1_id', t)) like '22023%');
  end loop;
  r := pg_temp.as_q(sk, format($q$select public.fftt_submit_match_result_v2(%L,%L,%s,%s,gen_random_uuid(),%L,'22-20',1)$q$, E, row0->>'match_id', row0->>'bracket_generation', row0->>'match_version', row0->>'player_1_id'));
  rep := rep || pg_temp.ck('Bo1/21 score 22-20 (win by two after the target) accepted', r->>'status' = 'accepted');
  r := pg_temp.as_q(org, format($q$select public.fftt_submit_match_result_v2(%L,%L,%s,%s,gen_random_uuid(),%L,'21-15',1)$q$, E, row0->>'match_id', row0->>'bracket_generation', row0->>'match_version', row0->>'player_2_id'));
  rep := rep || pg_temp.ck('a stale/duplicate submission is durably rejected, not applied', r->>'status' = 'rejected' and r->>'reason' = 'stale-match-version');
  r := pg_temp.as_q(sk, format($q$select public.fftt_assign_table_v3(%L,%L,1)$q$, E, row1->>'match_id'));
  t := pg_temp.try_as(sk, format($q$select public.fftt_assign_table_v3(%L,%L,1)$q$, E, row2->>'match_id'));
  rep := rep || pg_temp.ck('occupied table refused by the server ('||left(t,60)||')', t like 'P0001%' and t like '%table-in-use%');
  r := pg_temp.as_q(org, format($q$select public.fftt_set_match_format_v4(%L,%L,3,11)$q$, E, row2->>'match_id'));
  rep := rep || pg_temp.ck('organizer override to Best of 3 / 11 before any result', r->>'status' = 'updated');
  t := pg_temp.try_as(sk, format($q$select public.fftt_submit_match_result_v2(%L,%L,%s,%s,gen_random_uuid(),%L,'21-15',1)$q$, E, row2->>'match_id', row2->>'bracket_generation', row2->>'match_version', row2->>'player_1_id'));
  rep := rep || pg_temp.ck('a Bo1-style score for the overridden Bo3 match is refused', t like '22023%' and t like '%scores-count%');
  r := pg_temp.as_q(sk, format($q$select public.fftt_submit_match_result_v2(%L,%L,%s,%s,gen_random_uuid(),%L,'11-7, 11-9',1)$q$, E, row2->>'match_id', row2->>'bracket_generation', row2->>'match_version', row2->>'player_1_id'));
  rep := rep || pg_temp.ck('Bo3/11 score 11-7, 11-9 accepted', r->>'status' = 'accepted');
  t := pg_temp.try_as(org, format($q$select public.fftt_set_match_format_v4(%L,%L,1,21)$q$, E, row2->>'match_id'));
  rep := rep || pg_temp.ck('a recorded match format is locked', t like 'P0001%' and t like '%format-locked%');
  t := pg_temp.try_as(org, format($q$select public.fftt_set_formats_v4(%L,'{"champ":{"best_of":3,"points":11}}'::jsonb)$q$, E));
  rep := rep || pg_temp.ck('a played category is locked at event level', t like 'P0001%' and t like '%format-locked%');
  t := pg_temp.try_as(org, format($q$select public.fftt_delete_event_v4(%L,'V4 ACCEPTANCE DISPOSABLE (fictional, rolled back)')$q$, E));
  rep := rep || pg_temp.ck('an event with players/results cannot be deleted ('||left(t,40)||')', t like 'P0001%');

  -- public view + privacy
  perform pg_temp.as_q(org, format($q$select public.fftt_set_visibility_v3(%L,true)$q$, E));
  pub := pg_temp.as_q(null, format($q$select jsonb_agg(to_jsonb(t)) from public.fftt_public_tournament_v1 t where t.event_name like 'V4 ACCEPTANCE%%'$q$), true);
  rep := rep || pg_temp.ck('anonymous spectators see the published disposable event with formats', pub is not null and pub::text like '%"best_of": 1%' and pub::text like '%"points_to_win": 21%');
  rep := rep || pg_temp.ck('public data has no ratings, refs, e-mail or ids', pub::text !~* 'rating|ACCEPTREF|@|registration|source' and pub::text not like '%'||E::text||'%');
  rep := rep || pg_temp.ck('anonymous cannot read the private roster table', pg_temp.try_as(null, 'select to_jsonb(count(*)) from fftt_private.players', true) like '42%');
  r := pg_temp.as_q(org, format($q$select public.fftt_export_event_v3(%L)$q$, E));
  rep := rep || pg_temp.ck('private backup has formats and refs; roster and audit sections hold no contact data (staff account e-mails are organizer-only, by design)', r::text like '%formats%' and r::text like '%ACCEPTREF%' and (r->'snapshot'->'players')::text !~ '@' and (r->'audit')::text !~ '@' and (r->'snapshot'->'matches')::text !~ '@');

  -- ===== E2: historical Best of 5 compatibility (pre-V4 rows have no stamp)
  r := pg_temp.as_q(org, $q$select public.fftt_create_event_v3('V4 ACCEPTANCE HISTORICAL DISPOSABLE (rolled back)','2026-12-30',2)$q$);
  E2 := (r->>'event_id')::uuid;
  perform pg_temp.as_q(org, format($q$select public.fftt_upsert_players_v3(%L,'[{"name":"Hist Player A","rating":3,"rating_status":"provisional"},{"name":"Hist Player B","rating":2,"rating_status":"provisional"}]'::jsonb)$q$, E2));
  perform pg_temp.as_q(org, format($q$select public.fftt_set_checkin_bulk_v3(%L,null,true)$q$, E2));
  snap := pg_temp.as_q(org, format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, E2));
  select jsonb_agg(p->>'id') into slots from jsonb_array_elements(snap->'players') p;
  perform pg_temp.as_q(org, format($q$select public.fftt_build_championship_v3(%L,%L::jsonb,0,false)$q$, E2, slots::text));
  update fftt_private.matches set best_of = null, points_to_win = null where event_id = E2;   -- emulate a pre-V4 (historical) match
  rows := pg_temp.as_q(org, format($q$select jsonb_agg(to_jsonb(t)) from public.fftt_matchdesk_v2(%L) t$q$, E2));
  rep := rep || pg_temp.ck('historical final resolves to Best of 5 to 11', (rows->0->>'best_of')::int = 5 and (rows->0->>'points_to_win')::int = 11);
  t := pg_temp.try_as(org, format($q$select public.fftt_submit_match_result_v2(%L,%L,%s,%s,gen_random_uuid(),%L,'11-7, 11-9',1)$q$, E2, rows->0->>'match_id', rows->0->>'bracket_generation', rows->0->>'match_version', rows->0->>'player_1_id'));
  rep := rep || pg_temp.ck('a Best-of-3 score is refused for the historical Best-of-5 final', t like '22023%');
  r := pg_temp.as_q(org, format($q$select public.fftt_submit_match_result_v2(%L,%L,%s,%s,gen_random_uuid(),%L,'11-5, 11-6, 11-7',1)$q$, E2, rows->0->>'match_id', rows->0->>'bracket_generation', rows->0->>'match_version', rows->0->>'player_1_id'));
  rep := rep || pg_temp.ck('historical Best-of-5 result accepted', r->>'status' = 'accepted');
  select count(*) into stamp_n from fftt_private.matches where event_id = E2 and best_of is not null;
  rep := rep || pg_temp.ck('the historical match was not rewritten (still unstamped)', stamp_n = 0);
  snap := pg_temp.as_q(org, format($q$select public.fftt_organizer_snapshot_v3(%L)$q$, E2));
  rep := rep || pg_temp.ck('snapshot marks it historical (format_legacy, Best of 5)', (select bool_and((m->>'format_legacy')::boolean and (m->>'best_of')::int = 5) from jsonb_array_elements(snap->'matches') m where m->>'status' = 'complete'));
  r := pg_temp.as_q(org, format($q$select public.fftt_correct_result_v3(%L,%L,%s,%L,'5-11, 6-11, 7-11','Acceptance: correction under the historical format')$q$, E2, rows->0->>'match_id', (snap->'matches'->0->>'version'), rows->0->>'player_2_id'));
  rep := rep || pg_temp.ck('historical result corrected under Best of 5', r->>'status' = 'corrected');

  -- ===== E3: archive / restore (restore never re-publishes); E4: guarded deletion of an empty draft
  r := pg_temp.as_q(org, $q$select public.fftt_create_event_v3('V4 ACCEPTANCE ARCHIVE DISPOSABLE (rolled back)','2026-12-29',2)$q$);
  E3 := (r->>'event_id')::uuid;
  perform pg_temp.as_q(org, format($q$select public.fftt_set_lifecycle_v3(%L,'archived')$q$, E3));
  r := pg_temp.as_q(org, format($q$select public.fftt_restore_event_v4(%L)$q$, E3));
  rep := rep || pg_temp.ck('archive then restore returns to draft', r->>'lifecycle' = 'draft');
  r := pg_temp.as_q(org, $q$select public.fftt_create_event_v3('V4 ACCEPTANCE EMPTY DRAFT DISPOSABLE (rolled back)','2026-12-28',2)$q$);
  E4 := (r->>'event_id')::uuid;
  t := pg_temp.try_as(org, format($q$select public.fftt_delete_event_v4(%L,'wrong name')$q$, E4));
  rep := rep || pg_temp.ck('deletion needs the exact name', t like '22023%');
  t := pg_temp.try_as(sk, format($q$select public.fftt_delete_event_v4(%L,'V4 ACCEPTANCE EMPTY DRAFT DISPOSABLE (rolled back)')$q$, E4));
  rep := rep || pg_temp.ck('a scorekeeper (no grant) cannot delete', t like '42501%');
  r := pg_temp.as_q(org, format($q$select public.fftt_delete_event_v4(%L,'V4 ACCEPTANCE EMPTY DRAFT DISPOSABLE (rolled back)')$q$, E4));
  rep := rep || pg_temp.ck('the empty draft was deleted and its audit trail tombstoned', r->>'status' = 'deleted' and (select count(*) from fftt_private.deleted_events where event_id = E4) = 1 and not exists (select 1 from fftt_private.events where id = E4));
  rep := rep || pg_temp.ck('the real completed fictional event cannot be deleted (it is not an empty draft)', pg_temp.try_as(org, format($q$select public.fftt_delete_event_v4(%L,%L)$q$, (select id from fftt_private.events where lifecycle = 'complete' limit 1), (select event_name from fftt_private.events where lifecycle = 'complete' limit 1))) not like 'OK%');

  rep := rep || pg_temp.ck('pre-existing events untouched inside the script', (select count(*) from fftt_private.events where id not in (E,E2,E3)) = ev_before);
  raise exception E'ACCEPTANCE REPORT (this transaction is rolled back; nothing persists)%\nPASSED=% FAILED=%', rep, (length(rep) - length(replace(rep,'PASS ','')))/5, (length(rep) - length(replace(rep,'FAIL ','')))/5;
end
$acc$;
