import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeExport,normalizeSchema,readOnlyQuery,createBackup,readToken,verifyPrivateInventory,reverifySavedBackup,
  PROJECT_REF,TABLES} from '../tools/ops/fftt_backup.mjs';

const md5=s=>crypto.createHash('md5').update(s).digest('hex');
const rows=()=>TABLES.map(tbl=>tbl==='events'?
  {tbl,n:1,fp:md5('fictional-event'),data:JSON.stringify([{id:'fictional-uuid',public_visible:true}])}:
  tbl==='platform_organizers'?
  {tbl,n:1,fp:md5('fictional-organizer'),data:JSON.stringify([{user_id:'fictional-uuid'}])}:
  {tbl,n:0,fp:md5(''),data:'[]'});
const inventory=()=>[...TABLES.filter(t=>t!=='auth_users'),'registration_gate'].map(relname=>({relname}));
const schema=()=>['column','constraint','function','rls','trigger','view']
  .map((kind,i)=>({kind,n:i+1,fingerprint:md5(kind)}));
const response=(data,status=201)=>({ok:status===201,status,json:async()=>data});
test('builds a complete current backup with 20 table groups, including empty V6/showcase and publication flags',()=>{
  const doc=normalizeExport(rows(),PROJECT_REF,new Date('2026-11-07T00:00:00Z'));
  assert.equal(doc.format,'fftt-hosted-export-v2');
  assert.equal(TABLES.length,20);
  assert.deepEqual(Object.keys(doc.tables).sort(),[...TABLES].sort());
  for (const t of ['match_game_progress','game_progress_decisions','showcase_progress_watermarks',
    'showcase_reset_baseline','showcase_reset_decisions']) assert.deepEqual(doc.tables[t].rows,[]);
  assert.equal(doc.tables.events.rows[0].public_visible,true);
  assert.deepEqual(doc.tables.matches.rows,[]);
  assert.equal(doc.tables.matches.fingerprint,md5(''));
  assert.equal(doc.taken_at,'2026-11-07T00:00:00.000Z');
  assert.equal(Object.keys(normalizeSchema(schema())).length,6);
  assert.doesNotThrow(()=>verifyPrivateInventory(inventory()));
});
test('wrong project, incomplete content, and bad schema metadata fail closed',()=>{
  assert.throws(()=>normalizeExport([]),/Incomplete export/);
  assert.throws(()=>normalizeExport(rows(),'another-project'),/unknown project/);
  assert.throws(()=>normalizeExport([...rows(),rows()[0]]),/Incomplete export/);
  assert.throws(()=>normalizeExport(rows().map((r,i)=>i===0?{...r,n:2}:r)),/Incomplete/);
  assert.throws(()=>normalizeExport(rows().map((r,i)=>i===0?{...r,data:'not-json'}:r)),/Malformed table JSON/);
  assert.throws(()=>normalizeSchema(schema().slice(1)),/Incomplete/);
  assert.throws(()=>verifyPrivateInventory(inventory().slice(1)),/Unexpected or missing/);
  assert.throws(()=>verifyPrivateInventory(inventory().filter(x=>x.relname!=='showcase_reset_baseline')),
    /Unexpected or missing/);
  assert.throws(()=>normalizeExport(rows().filter(x=>x.tbl!=='match_game_progress')),
    /Incomplete export/);
  assert.throws(()=>normalizeExport(rows().filter(x=>x.tbl!=='showcase_reset_baseline')),
    /Incomplete export/);
  assert.throws(()=>verifyPrivateInventory([...inventory(),{relname:'new_unknown_table'}]),/Unexpected or missing/);
});
test('only calls the dedicated read-only SQL API and never exposes response details',async()=>{
  const calls=[];
  const mock=async (url,opts)=>{calls.push([url,opts]);return response(rows());};
  const sql='select many required records from fftt_private.events';
  assert.equal((await readOnlyQuery(sql,'fictional-testing-token',{fetchImpl:mock})).length,20);
  assert.equal(calls[0][1].method,'POST');
  assert.match(calls[0][0],/\/database\/query\/read-only$/);
  assert.deepEqual(JSON.parse(calls[0][1].body),{query:sql});
  await assert.rejects(readOnlyQuery(sql,'fictional-testing-token',
    {fetchImpl:async()=>response({secret:'NEVER ECHO'},403)}),/permission denied/);
  await assert.rejects(readOnlyQuery(sql,'fictional-testing-token',
    {fetchImpl:async()=>response({secret:'NEVER ECHO'},404)}),/fallback is forbidden/);
});
test('prefers environment token and does not print or require Mac keychain in tests',()=>{
  assert.equal(readToken({env:{SUPABASE_ACCESS_TOKEN:'test-only-token'},platform:'linux',
    home:'/definitely/no/token-file'}),'test-only-token');
});
test('writes private verified local and mirrored copies, with matching SHA-256',async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'fftt-backup-test-'));
  const backupDir=path.join(parent,'backups'),mirrorDir=path.join(parent,'mirror');
  let requests=0,verified=0;
  const mock=async()=>response(++requests===1?rows():requests===2?schema():inventory());
  try {
    const report=await createBackup({token:'fictional-testing-token',fetchImpl:mock,
      backupDir,mirrorDir,verify:async file=>{
        verified++;
        assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).tables.events.count,1);
      },now:new Date('2026-11-07T00:00:00Z'),printer:()=>{}});
    assert.equal(requests,3);assert.equal(verified,1);
    assert.equal(report.result,'VERIFIED_AND_MIRRORED');
    assert.equal(fs.statSync(report.backup).mode&0o777,0o600);
    assert.equal(fs.statSync(backupDir).mode&0o777,0o700);
    assert.equal(fs.statSync(report.mirror_path).mode&0o777,0o600);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(report.mirror_path)).digest('hex'),report.sha256);
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
});
test('failure retains an explicitly UNVERIFIED private backup and never creates a mirror',async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'fftt-backup-failure-'));
  let requests=0;
  const mock=async()=>response(++requests===1?rows():requests===2?schema():inventory());
  try {
    await assert.rejects(createBackup({token:'fictional-testing-token',fetchImpl:mock,
      backupDir:path.join(parent,'backups'),mirrorDir:path.join(parent,'mirror'),
      verify:async()=>{throw new Error('fictional clone failure');},printer:()=>{}}),/NOT VERIFIED/);
    const dir=path.join(parent,'backups'),files=fs.readdirSync(dir);
    assert.equal(files.length,2);
    const result=JSON.parse(fs.readFileSync(path.join(dir,files.find(x=>x.endsWith('.report.json'))),'utf8'));
    assert.equal(result.verified,false);
    assert.equal(result.result,'VERIFICATION_FAILED');
    assert.equal(fs.existsSync(path.join(parent,'mirror')),false);
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
});
test('refuses to store raw database exports inside a Git checkout',async()=>{
  let requests=0;
  const mock=async()=>response(++requests===1?rows():requests===2?schema():inventory());
  await assert.rejects(createBackup({token:'fictional-testing-token',fetchImpl:mock,
    backupDir:path.resolve('tools'),verify:async()=>{},printer:()=>{}}),
    /outside Git|within a Git checkout/);
});

test('CLI entrypoint runs through a symlinked temporary worktree path, not silent exit',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fftt-cli-symlink-'));
  const cli=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tools/ops/fftt_backup.mjs');
  try {
    fs.symlinkSync(path.dirname(cli),path.join(dir,'ops'),'dir');
    const res=spawnSync(process.execPath,[path.join(dir,'ops','fftt_backup.mjs'),'--help'],
      {encoding:'utf8',timeout:15000});
    assert.equal(res.status,0, 'CLI exit: '+res.stderr);
    assert.match(res.stdout,/Usage: \.\/tools\/ops\/fftt-backup/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('reverifying a saved failed export keeps original bytes and failure record, with no new API calls', async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'fftt-reverify-'));
  let calls=0;
  const api=async()=>response(++calls===1?rows():calls===2?schema():inventory());
  try {
    await assert.rejects(createBackup({
      token:'synthetic-test-token',fetchImpl:api,backupDir:path.join(parent,'backups'),
      verify:async()=>{throw Error('fictional first proof rejected');},printer:()=>{}
    }),/NOT VERIFIED/);
    const folder=path.join(parent,'backups');
    const filename=fs.readdirSync(folder).find(name=>name.endsWith('.json') && !name.endsWith('.report.json'));
    const file=path.join(folder,filename);
    const reportFile=file.slice(0,-5)+'.report.json';
    const raw=fs.readFileSync(file);
    const before=fs.readFileSync(reportFile);
    let checked=0;
    const proof=reverifySavedBackup(file,{
      verify:input=>{checked++;assert.equal(input,file);},
      now:new Date('2026-11-07T22:03:00Z'),printer:()=>{}
    });
    const outcome=JSON.parse(fs.readFileSync(proof,'utf8'));
    assert.equal(calls,3,'no new Supabase query during reverify');
    assert.equal(checked,1);
    assert.equal(outcome.result,'LOCAL_VERIFIED');
    assert.equal(outcome.previous_result,'VERIFICATION_FAILED');
    assert.equal(outcome.mirrored,false);
    assert.equal(outcome.sha256,crypto.createHash('sha256').update(raw).digest('hex'));
    assert.deepEqual(fs.readFileSync(file),raw,'original private export preserved byte-for-byte');
    assert.deepEqual(fs.readFileSync(reportFile),before,'original FAIL report preserved');
    assert.equal(fs.statSync(proof).mode&0o777,0o600);
    fs.appendFileSync(file,'corrupt');
    assert.throws(()=>reverifySavedBackup(file,{verify:()=>{throw Error('should not run');},printer:()=>{}}),
      /hash or original report mismatch/);
    assert.equal(calls,3,'tampering must not contact hosted services');
  } finally {fs.rmSync(parent,{recursive:true,force:true});}
});

test('new current exports pin C collation for both record order and fingerprint',()=>{
  const sql=fs.readFileSync(new URL('../tools/ops/hosted_export.sql',import.meta.url),'utf8');
  assert.equal([...sql.matchAll(/jsonb_agg\(j order by j::text collate "C"\)/g)].length,2,
    'new source export hashes and row arrays must use the same stable bytewise sort');
});
