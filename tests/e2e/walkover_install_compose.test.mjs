/** Synthetic-only review of the one-transaction walkover/withdrawal composer. No hosted connections. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createHostedEquivalentDb} from './hosted_equivalent.mjs';
import {compose,EXPECTED_HISTORY,NEW_VERSION,NEW_NAME,PINNED_PROPOSAL_GIT_BLOB} from '../../tools/ops/compose_walkover_install.mjs';

const source=fs.readFileSync(new URL('../../supabase/proposals/FFTT3_REHEARSAL_WALKOVER_WITHDRAWAL_20261109_DO_NOT_APPLY.sql',import.meta.url),'utf8');
const gitBlob=s=>crypto.createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0'+s).digest('hex');
const combined=compose(source);
const initHistory=versions =>
  "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text); "+
  "insert into supabase_migrations.schema_migrations(version) values "+
  versions.map(x=>"('"+x+"')").join(',')+";";
const fnMd5=db=>db.admin("select md5(pg_get_functiondef('fftt_private.forfeit_match_v3(uuid,uuid,bigint,uuid,text)'::regprocedure)) as fp").then(r=>r[0].fp);

test('proposal is source-pinned; unreviewed SQL is refused',()=>{
  assert.equal(gitBlob(source),PINNED_PROPOSAL_GIT_BLOB);
  assert.match(combined,/^begin;\ndo \$history_guard\$/);
  assert.match(combined,/values \('20261109170000','fftt_rehearsal_walkover_withdrawal'\);/);
  assert.match(combined,/commit;\n$/);
  assert.throws(()=>compose(source+'\n-- unexpected'),/unreviewed/);
  assert.throws(()=>compose(source.replace('begin;','begin; rollback;')),/unreviewed/);
});

test('wrong hosted history installs nothing; exact nine-version history installs once; replay fails closed',{timeout:240000},async()=>{
  let db=await createHostedEquivalentDb({corrections:true});
  try{
    await db.db.exec(initHistory(EXPECTED_HISTORY.slice(0,-1)));
    const before=await fnMd5(db);
    await assert.rejects(db.db.exec(combined),/reviewed nine entries/);
    await db.db.exec('rollback').catch(()=>{});
    assert.equal(await fnMd5(db),before);
    assert.equal((await db.admin("select to_regprocedure('public.fftt_withdraw_preplay_v7(uuid,uuid,integer,jsonb,text)') is not null as present"))[0].present,false);
  }finally{await db.db.close();}

  db=await createHostedEquivalentDb({corrections:true});
  try{
    const org=await db.addUser('source-only-installer@fftt-fictional.invalid',{platformOrganizer:true});
    const ev=await db.rpc(org,'fftt_create_event_v3',{
      p_name:'Synthetic installer exercise',p_date:'2026-11-22',p_table_count:2});
    const E=ev.event_id;
    await db.db.exec(initHistory(EXPECTED_HISTORY));
    const before=(await db.admin('select count(*)::int n from fftt_private.events'))[0].n;
    const oldFunction=await fnMd5(db);
    await db.db.exec(combined);
    const installed=await db.admin('select version,name,statements from supabase_migrations.schema_migrations order by version');
    assert.equal(installed.length,10);
    assert.deepEqual(installed.at(-1),{version:NEW_VERSION,name:NEW_NAME,statements:null});
    const nowFunction=await fnMd5(db);
    assert.notEqual(nowFunction,oldFunction);
    assert.equal((await db.admin('select count(*)::int n from fftt_private.events'))[0].n,before);
    assert.equal((await db.admin('select id from fftt_private.events'))[0].id,E);
    const grants=(await db.admin("select has_function_privilege('anon','public.fftt_withdraw_preplay_v7(uuid,uuid,integer,jsonb,text)','execute') as anon, has_function_privilege('authenticated','public.fftt_withdraw_preplay_v7(uuid,uuid,integer,jsonb,text)','execute') as staff"))[0];
    assert.equal(grants.anon,false);
    assert.equal(grants.staff,true);

    await assert.rejects(db.db.exec(combined),/reviewed nine entries/);
    await db.db.exec('rollback').catch(()=>{});
    assert.equal((await db.admin('select count(*)::int n from supabase_migrations.schema_migrations'))[0].n,10);
    assert.equal(await fnMd5(db),nowFunction);
  }finally{await db.db.close();}
});
