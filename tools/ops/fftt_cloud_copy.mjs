#!/usr/bin/env node
/** Encrypt an ALREADY VERIFIED owner-held FFTT export before Google Drive sync.
 * No hosted database connection, tokens, or private rows in stdout or GitHub.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const PROJECT = 'copmkalfkkrkzheohwuc';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const die = (ok,message) => { if(!ok) throw new Error(message); };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function existsFile(f){return fs.existsSync(f)&&fs.lstatSync(f).isFile()&&!fs.lstatSync(f).isSymbolicLink();}
function reportData(f){
  die(existsFile(f)&&!(fs.lstatSync(f).mode&0o077),'Private backup/report is missing, shared or symlinked');
  try{return JSON.parse(fs.readFileSync(f,'utf8'));}
  catch{throw new Error('Private verification report is invalid JSON');}
}
export function verifiedSource(input){
  const file=path.resolve(input);
  die(existsFile(file)&&!(fs.lstatSync(file).mode&0o077),'Original private backup must be a mode-600 regular file');
  die(file.endsWith('.json')&&!file.endsWith('.report.json'),'Expected original FFTT export JSON file');
  const checksum=sha(fs.readFileSync(file)), dir=path.dirname(file),base=path.basename(file,'.json');
  const candidates=fs.readdirSync(dir).filter(n=>n===base+'.report.json'||
    (n.startsWith(base+'.reverified-')&&n.endsWith('.report.json'))).map(n=>path.join(dir,n));
  const valid=candidates.map(f=>({file:f,report:reportData(f)})).filter(({report:r})=>
    r.project===PROJECT&&r.backup===file&&r.sha256===checksum&&r.verified===true&&
    (r.result==='LOCAL_VERIFIED'||r.result==='VERIFIED_AND_MIRRORED'));
  die(valid.length,'No matching successful restore verification report; cloud copy blocked');
  const recent=valid.sort((a,b)=>(b.report.verification_time??b.report.timestamp??'')
    .localeCompare(a.report.verification_time??a.report.timestamp??''))[0];
  return {file,checksum,reportFile:recent.file};
}
export function findDriveRoots(home=os.homedir()){
  const roots=[],cloud=path.join(home,'Library','CloudStorage');
  if(fs.existsSync(cloud))for(const name of fs.readdirSync(cloud)){
    if(!/google.?drive/i.test(name))continue;
    const dir=path.join(cloud,name);
    for(const sub of ['My Drive','MyDrive']){
      const p=path.join(dir,sub);
      if(fs.existsSync(p)&&fs.statSync(p).isDirectory())roots.push(p);
    }
    if(!roots.some(p=>p.startsWith(dir+path.sep))&&
      fs.existsSync(dir)&&fs.statSync(dir).isDirectory())roots.push(dir);
  }
  for(const p of ['/Volumes/GoogleDrive/My Drive',path.join(home,'Google Drive','My Drive')])
    if(fs.existsSync(p)&&fs.statSync(p).isDirectory())roots.push(p);
  return [...new Set(roots.map(p=>path.resolve(p)))];
}
function resolveDrive(explicit,home){
  if(explicit){
    const p=path.resolve(explicit.startsWith('~/')?path.join(home,explicit.slice(2)):explicit);
    die(fs.existsSync(p)&&fs.statSync(p).isDirectory(),'Chosen Google Drive folder is not accessible');
    return p;
  }
  const found=findDriveRoots(home);
  die(found.length===1,found.length===0?
    'Cannot find mounted Google Drive; use --drive-root with its Finder My Drive path':
    'Multiple Google Drive accounts mounted; use --drive-root to choose one');
  return found[0];
}
/** Prompt silently on a local terminal, confirm, and return NUL-terminated bytes.
 * No secret in CLI arguments, environment variables, files, or logs.
 */
export function promptArchivePassphrase({spawn=spawnSync}={}){
  const script=String.raw`set -e
exec 3</dev/tty
IFS= read -r -s -p 'New FFTT archive passphrase: ' PASS <&3
printf '\n' >/dev/tty
IFS= read -r -s -p 'Confirm archive passphrase: ' CONFIRM <&3
printf '\n' >/dev/tty
if [[ -z "$PASS" || "$PASS" != "$CONFIRM" ]]; then
  printf 'Archive passphrases must match. No archive created.\n' >&2
  exit 1
fi
printf '%s\0' "$PASS"`;
  const received=spawn('/bin/bash',['-c',script],
    {stdio:['ignore','pipe','inherit'],timeout:180000,encoding:null});
  if(received.status!==0||!Buffer.isBuffer(received.stdout)){
    if(Buffer.isBuffer(received.stdout))received.stdout.fill(0);
    throw new Error('A private interactive terminal is required for archive passphrase entry');
  }
  const key=received.stdout;
  if(key.length<13||key.at(-1)!==0||key.subarray(0,-1).includes(0)){
    key.fill(0);
    throw new Error('Archive passphrase must contain at least 12 characters');
  }
  return key;
}
function ensureLocalPrivate(dir){
  const p=path.resolve(dir);
  die(!p.startsWith(ROOT+path.sep)&&p!==ROOT,'Never store private backups inside Git');
  fs.mkdirSync(p,{recursive:true,mode:0o700});
  die(!(fs.statSync(p).mode&0o077),'Local encrypted archive folder must be mode 700');
  return p;
}
export function copyEncryptedToDrive({backupFile,driveRoot,home=os.homedir(),
  spawn=spawnSync,readPassphrase=promptArchivePassphrase,now=new Date(),logger=console.log}={}){
  die(process.platform==='darwin'||spawn!==spawnSync,'Encrypted cloud archive creation requires macOS');
  const source=verifiedSource(backupFile),drive=resolveDrive(driveRoot,home);
  const local=ensureLocalPrivate(path.join(home,'Documents','FFTT-private','encrypted-archives'));
  const name='fftt-private-'+now.toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex')+'.dmg';
  const output=path.join(local,name),stage=fs.mkdtempSync(path.join(os.tmpdir(),'fftt-encrypt-stage-'));
  fs.chmodSync(stage,0o700);
  let archiveReady=false,secret=null;
  try{
    for(const f of [source.file,source.reportFile]){
      const to=path.join(stage,path.basename(f));
      fs.copyFileSync(f,to,fs.constants.COPYFILE_EXCL);fs.chmodSync(to,0o600);
    }
    logger('Enter and confirm a new private archive passphrase; save it in your password manager.');
    secret=readPassphrase();
    die(Buffer.isBuffer(secret)&&secret.length>=13&&secret.at(-1)===0
      &&!secret.subarray(0,-1).includes(0),'No valid private archive passphrase');
    // Both commands read the SAME key from stdin. No GUI prompts or argv secrets.
    const created=spawn('/usr/bin/hdiutil',['create','-srcfolder',stage,'-format','UDZO',
      '-encryption','AES-256','-stdinpass','-volname','FFTT Private Backup',output],
      {input:secret,encoding:'utf8',timeout:240000});
    die(created.status===0&&existsFile(output),'AES-256 disk image creation failed');
    const encrypted=spawn('/usr/bin/hdiutil',['isencrypted',output],{encoding:'utf8',timeout:15000});
    die(encrypted.status===0&&/encrypted\s*:\s*(?:yes|true)\b/i.test(encrypted.stdout??''),
      'Disk image did not confirm encryption; Google Drive copy refused');
    const checked=spawn('/usr/bin/hdiutil',['verify','-stdinpass',output],
      {input:secret,encoding:'utf8',timeout:90000});
    die(checked.status===0,'Encrypted disk image integrity check failed');
    archiveReady=true;
  }finally{
    if(Buffer.isBuffer(secret))secret.fill(0);
    fs.rmSync(stage,{recursive:true,force:true});
    if(!archiveReady&&fs.existsSync(output))fs.rmSync(output,{force:true});
  }
  die(archiveReady,'No usable encrypted archive created');
  const destinationDir=path.join(drive,'FFTT Private Backups');
  fs.mkdirSync(destinationDir,{recursive:true});
  const target=path.join(destinationDir,name),expected=sha(fs.readFileSync(output));
  try{
    fs.copyFileSync(output,target,fs.constants.COPYFILE_EXCL);
    die(expected===sha(fs.readFileSync(target)),'Google Drive folder copy checksum mismatch');
  }catch(e){
    // Only encrypted bytes can reach Drive. Discard incomplete copies.
    if(fs.existsSync(target))fs.rmSync(target,{force:true});
    throw e;
  }
  const proof={format:'fftt-encrypted-cloud-copy-v1',source_sha256:source.checksum,
    encrypted_archive_sha256:expected,archive_name:name,
    local_archive:output,drive_folder_copy:target,local_checksum_verified:true,
    drive_sync:'UNCONFIRMED',verified_backup_report:path.basename(source.reportFile)};
  const report=path.join(local,name+'.report.json');
  fs.writeFileSync(report,JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
  logger('FFTT ENCRYPTED COPY: LOCAL HASH VERIFIED');
  logger('Encrypted archive: '+output);
  logger('Google Drive folder copy: '+target);
  logger('SHA-256: '+expected);
  logger('Report: '+report);
  logger('CLOUD SYNC: UNCONFIRMED. Confirm upload is complete in Google Drive, not just Finder.');
  return proof;
}
function main(args=process.argv.slice(2)){
  if(args.length===1&&args[0]==='--help'){
    console.log('Usage: ./tools/ops/fftt-cloud-copy --backup /private/verified-export.json [--drive-root "/path/to/My Drive"]');
    return;
  }
  const backup=args.indexOf('--backup'),drive=args.indexOf('--drive-root');
  die(backup>=0&&args[backup+1]&&(args.length===2||(args.length===4&&drive>=0&&args[drive+1])),
    'Supply --backup /private/verified-export.json and optionally --drive-root /path/to/My-Drive');
  copyEncryptedToDrive({backupFile:args[backup+1],driveRoot:drive>=0?args[drive+1]:null});
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url))
  try{main();}catch(e){console.error('FFTT cloud copy failed: '+e.message);process.exitCode=1;}
