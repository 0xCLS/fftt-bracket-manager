#!/usr/bin/env node
/** FFTT private backup: read-only Supabase API, disposable V6 rehearsal, optional mirror. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const PROJECT_REF = 'copmkalfkkrkzheohwuc';
export const TABLES = Object.freeze([
  'audit_events','brackets','consolation_reviews','deleted_events','doubles_finale',
  'event_staff','events','matches','platform_organizers','players','registration_links',
  'registration_sources','result_submissions','score_decisions_v2','auth_users'
]);
const KINDS = ['column','constraint','function','rls','trigger','view'];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MD5 = /^[a-f0-9]{32}$/i;
const EXCLUDED_SECRET_TABLE = 'registration_gate';
const EMPTY_FP = crypto.createHash('md5').update('').digest('hex');
const ACCOUNT = 'fftt-backup', SERVICE = 'FFTT-Supabase-ReadOnly';
const check = (ok,message) => { if (!ok) throw new Error(message); };

export function normalizeExport(rows, project=PROJECT_REF, now=new Date()) {
  check(project === PROJECT_REF,'Refusing backup from an unknown project');
  check(Array.isArray(rows) && rows.length === TABLES.length,
    'Incomplete export: all 15 table groups are required, even if empty');
  const seen = new Map();
  for (const row of rows) {
    check(row && TABLES.includes(row.tbl) && !seen.has(row.tbl),'Unexpected or duplicate table');
    const count = Number(row.n);
    check(Number.isSafeInteger(count) && count >= 0 && MD5.test(row.fp ?? ''),'Invalid count or fingerprint');
    let records;
    try { records = typeof row.data === 'string' ? JSON.parse(row.data) : row.data; }
    catch { throw new Error('Malformed table JSON'); }
    check(Array.isArray(records) && records.length === count &&
      records.every(v => v && typeof v === 'object' && !Array.isArray(v)),
      'Incomplete or malformed table rows');
    seen.set(row.tbl,{count,fingerprint:row.fp.toLowerCase(),rows:records});
  }
  const tables = Object.fromEntries(TABLES.map(t => [t,seen.get(t) ??
    {count:0,fingerprint:EMPTY_FP,rows:[]}]));
  check(tables.events.count > 0 && tables.platform_organizers.count > 0,
    'No events or organizer: refusing possibly wrong project');
  return {format:'fftt-hosted-export-v1',project,taken_at:now.toISOString(),read_only:true,tables};
}
export function normalizeSchema(rows) {
  check(Array.isArray(rows),'Invalid schema fingerprint response');
  const seen = new Map();
  for (const row of rows) {
    const n = Number(row?.n);
    check(row && KINDS.includes(row.kind) && !seen.has(row.kind) &&
      Number.isSafeInteger(n) && n >= 0 && MD5.test(row.fingerprint ?? ''),
      'Malformed schema fingerprint');
    seen.set(row.kind,String(n)+':'+row.fingerprint.toLowerCase());
  }
  check(KINDS.every(k => seen.has(k)),'Incomplete schema fingerprint');
  return Object.fromEntries(KINDS.map(k=>[k,seen.get(k)]));
}
export async function readOnlyQuery(query,token,{fetchImpl=fetch,project=PROJECT_REF}={}) {
  check(project===PROJECT_REF,'Unexpected project');
  check(typeof token==='string' && token.trim().length >= 12,'Read-only access token missing');
  check(typeof query==='string' && query.length>30,'Missing read-only query');
  let response;
  try {
    response=await fetchImpl('https://api.supabase.com/v1/projects/'+project+'/database/query/read-only',{
      method:'POST',headers:{Authorization:'Bearer '+token.trim(),'Content-Type':'application/json'},
      body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(90000)
    });
  } catch { throw new Error('Supabase read-only API is unreachable'); }
  if (!response.ok) {
    if ([401,403].includes(response.status))
      throw new Error('Read-only database permission denied: use a scoped database_read token');
    if (response.status===404)
      throw new Error('Read-only API unavailable; write-capable SQL fallback is forbidden');
    throw new Error('Read-only API request failed (HTTP '+response.status+')');
  }
  let rows;
  try { rows=await response.json(); }
  catch { throw new Error('Invalid read-only API JSON'); }
  check(Array.isArray(rows),'Unexpected read-only API payload');
  return rows;
}
export function verifyPrivateInventory(rows) {
  check(Array.isArray(rows),'Cannot verify private table inventory');
  const expected=[...TABLES.filter(t=>t!=='auth_users'),EXCLUDED_SECRET_TABLE].sort();
  const actual=rows.map(r=>r?.relname).sort();
  check(JSON.stringify(expected)===JSON.stringify(actual),
    'Unexpected or missing private table: update protected backup allowlist before proceeding');
}
function expand(p) {return path.resolve(p.startsWith('~/')?path.join(os.homedir(),p.slice(2)):p);}
function secureDir(p) {
  const dir=expand(p),relative=path.relative(ROOT,dir);
  check(relative==='..'||relative.startsWith('..'+path.sep),'Backups must be outside Git');
  const components=[];
  for (let q=dir;;q=path.dirname(q)) {components.push(q);if(q===path.dirname(q))break;}
  for (const q of components.reverse()) {
    check(!fs.existsSync(path.join(q,'.git')),'Backup path is within a Git checkout');
    if (fs.existsSync(q)) check(!fs.lstatSync(q).isSymbolicLink(),'Backup path contains a symlink');
  }
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  check(fs.statSync(dir).isDirectory() && !(fs.statSync(dir).mode & 0o077),
    'Backup folder must have private permissions (chmod 700)');
  return dir;
}
function save(file,contents) {
  const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  try {fs.writeFileSync(fd,contents);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function readToken({env=process.env,platform=process.platform,home=os.homedir(),spawn=spawnSync}={}) {
  if (env.SUPABASE_ACCESS_TOKEN?.trim()) return env.SUPABASE_ACCESS_TOKEN.trim();
  if (platform==='darwin') {
    const r=spawn('/usr/bin/security',
      ['find-generic-password','-a',ACCOUNT,'-s',SERVICE,'-w'],{encoding:'utf8',timeout:10000});
    if(r.status===0&&r.stdout?.trim())return r.stdout.trim();
  }
  const f=path.join(home,'.supabase','access-token');
  if (fs.existsSync(f)) {
    const s=fs.lstatSync(f);
    check(s.isFile()&&!s.isSymbolicLink()&&!(s.mode&0o077),'CLI token file must be mode 600');
    const token=fs.readFileSync(f,'utf8').trim();
    if (token) return token;
  }
  throw new Error('Missing token. Run ./tools/ops/fftt-backup --setup once on Mac or set SUPABASE_ACCESS_TOKEN.');
}
export function setupToken({platform=process.platform,spawn=spawnSync}={}) {
  check(platform==='darwin','Token setup requires macOS');
  const r=spawn('/usr/bin/security',['add-generic-password','-U','-a',ACCOUNT,'-s',SERVICE,'-w'],{stdio:'inherit'});
  check(r.status===0,'Mac Keychain setup incomplete');
}
function verifyLocal(file) {
  if (!fs.existsSync(path.join(ROOT,'tests/e2e/node_modules/@electric-sql/pglite/package.json'))) {
    const r=spawnSync('npm',['ci','--prefix',path.join(ROOT,'tests/e2e'),
      '--ignore-scripts','--no-audit','--no-fund','--prefer-offline'],
      {encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
    check(r.status===0,'Pinned test dependency installation failed');
  }
  const env={...process.env};
  delete env.SUPABASE_ACCESS_TOKEN;
  delete env.SUPABASE_DB_PASSWORD;
  const r=spawnSync(process.execPath,[path.join(ROOT,'tools/ops/restore_verify.mjs'),file,'--v6-preflight'],
    {cwd:ROOT,env,encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});
  const safeStage = (r.stdout ?? '').split(/\r?\n/).find(line =>
    /^FAIL  safe verification stage: (?:prepare disposable database|replay approved hosted pre-V6 schema layers|compare approved schema fingerprints|restore private application records|verify data fingerprints|verify foreign keys and API visibility|verify V6 proposal in disposable copy)$/.test(line));
  const safeSchema = (r.stdout ?? '').split(/\r?\n/).find(line =>
    /^FAIL  schema parity differs in categories: (?:column|constraint|function|rls|trigger|view|,| )+$/.test(line));
  check(r.status===0 && r.stdout?.includes('ALL CHECKS PASSED'),
    'Disposable V6 restore proof failed' +
    (safeStage ? ' [' + safeStage + ']' : '') +
    (safeSchema ? ' [' + safeSchema + ']' : '') +
    '; no private records printed');
}
export async function createBackup({token,fetchImpl=fetch,backupDir,mirrorDir,
  verify=verifyLocal,now=new Date(),printer=console.log}={}) {
  check(token,'Missing Supabase token');
  const exportSql=fs.readFileSync(path.join(ROOT,'tools/ops/hosted_export.sql'),'utf8');
  const schemaSql=fs.readFileSync(path.join(ROOT,'tools/ops/schema_fingerprint.sql'),'utf8');
  const rows=await readOnlyQuery(exportSql,token,{fetchImpl});
  const schema=await readOnlyQuery(schemaSql,token,{fetchImpl});
  // Metadata only: never read the registration_gate.secret bytea proof.
  const inventorySql="select c.relname from pg_catalog.pg_class c "+
    "join pg_catalog.pg_namespace n on n.oid=c.relnamespace "+
    "where n.nspname='fftt_private' and c.relkind='r' order by c.relname";
  verifyPrivateInventory(await readOnlyQuery(inventorySql,token,{fetchImpl}));
  const doc=normalizeExport(rows,PROJECT_REF,now);
  doc.schema_fingerprint=normalizeSchema(schema);
  doc.excluded_private_tables=[EXCLUDED_SECRET_TABLE];
  const dir=secureDir(backupDir??path.join(os.homedir(),'Documents/FFTT-private/backups'));
  const stem='fftt-pre-v6-'+now.toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex');
  const file=path.join(dir,stem+'.json'),reportFile=path.join(dir,stem+'.report.json');
  const contents=JSON.stringify(doc,null,2)+'\n',digest=sha256(contents);
  save(file,contents);
  const report={format:'fftt-private-backup-report-v1',project:PROJECT_REF,
    timestamp:now.toISOString(),backup:file,sha256:digest,verified:false,mirrored:false,
    result:'NOT_VERIFIED',schema_fingerprint:doc.schema_fingerprint,
    table_counts:Object.fromEntries(TABLES.map(t=>[t,doc.tables[t].count]))};
  try {
    await verify(file);
    report.verified=true;
    report.result='LOCAL_VERIFIED';
    if (mirrorDir) {
      const mirror=secureDir(mirrorDir);
      check(mirror!==dir,'Mirror folder must differ from source');
      const copy=path.join(mirror,path.basename(file));
      save(copy,fs.readFileSync(file));
      check(sha256(fs.readFileSync(copy))===digest,'Mirror checksum mismatch');
      report.mirrored=true;
      report.mirror_path=copy;
      report.result='VERIFIED_AND_MIRRORED';
    }
    save(reportFile,JSON.stringify(report,null,2)+'\n');
  } catch (e) {
    report.result='VERIFICATION_FAILED';
    save(reportFile,JSON.stringify(report,null,2)+'\n');
    throw new Error('Backup saved but NOT VERIFIED: '+e.message+'. Private file: '+file);
  }
  printer('FFTT BACKUP: '+report.result);
  printer('Project: '+PROJECT_REF);
  printer('Private file: '+file);
  printer('SHA-256: '+digest);
  printer('Report: '+reportFile);
  if (!report.mirrored) printer('Off-device mirror unverified. Configure FFTT_BACKUP_MIRROR_DIR for release readiness.');
  return report;
}
function reverifySavedBackup(input) {
  const file=expand(input);
  check(fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(),
    'Existing backup file is missing or is a symlink');
  check(!(fs.lstatSync(file).mode&0o077),'Existing backup must be private (mode 600)');
  secureDir(path.dirname(file));
  check(file.endsWith('.json') && !file.endsWith('.report.json'),'Expected FFTT private JSON backup path');
  const reportFile=file.slice(0,-5)+'.report.json';
  check(fs.existsSync(reportFile) && fs.lstatSync(reportFile).isFile() &&
    !fs.lstatSync(reportFile).isSymbolicLink(),'Original private verification report not found');
  const bytes=fs.readFileSync(file);
  let report;
  try {report=JSON.parse(fs.readFileSync(reportFile,'utf8')); }
  catch {throw new Error('Existing report is unreadable');}
  check(report.format==='fftt-private-backup-report-v1' && report.project===PROJECT_REF &&
    report.backup===file && report.sha256===sha256(bytes),'Backup hash or original report mismatch');
  verifyLocal(file);
  // Keep the original report as the chain of evidence. Write an independent
  // new proof using a timestamp rather than pretending earlier verification passed.
  const proof=file.slice(0,-5)+'.reverified-'+new Date().toISOString().replace(/[:.]/g,'-')+'.report.json';
  save(proof,JSON.stringify({...report,verified:true,mirrored:false,
    verification_time:new Date().toISOString(),result:'LOCAL_VERIFIED',
    previous_result:report.result,verification_mode:'disposable-v6-preflight'},null,2)+'\n');
  console.log('FFTT BACKUP: LOCAL_VERIFIED (existing private file)');
  console.log('SHA-256: '+report.sha256);
  console.log('Verification report: '+proof);
  console.log('Off-device mirror remains unverified.');
}
async function main(args=process.argv.slice(2)) {
  if(args.length===1&&args[0]==='--help') {
    console.log('Usage: ./tools/ops/fftt-backup [--setup | --verify-existing /private/backup.json | --mirror-dir /private/path]');
    return;
  }
  if(args.length===1&&args[0]==='--setup') {
    setupToken();console.log('Read-only token stored in Mac Keychain');return;
  }
  if(args.length===2 && args[0]==='--verify-existing') {
    reverifySavedBackup(args[1]);return;
  }
  const idx=args.indexOf('--mirror-dir');
  check((idx<0&&args.length===0)||(idx===0&&args.length===2),
    'Expected no arguments, --setup, --verify-existing /private/file.json, or --mirror-dir /private/path');
  await createBackup({token:readToken(),mirrorDir:idx<0?(process.env.FFTT_BACKUP_MIRROR_DIR||null):args[1]});
}
// Node resolves a symlinked entry file to its real location on macOS,
 // while argv[1] can retain /var or a symlinked TMPDIR path.
 // Compare real filesystem paths so a temporary Git worktree never silently exits.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('FFTT backup failed: '+e.message);process.exitCode=1;});
