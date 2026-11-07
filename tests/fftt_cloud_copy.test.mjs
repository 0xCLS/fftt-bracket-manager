import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {verifiedSource,findDriveRoots,copyEncryptedToDrive} from '../tools/ops/fftt_cloud_copy.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'fftt-cloud-fixture-'));
  const dir=path.join(home,'Documents','FFTT-private','backups');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'fftt-fictional.json');
  fs.writeFileSync(file,JSON.stringify({format:'fictional-test',characters:['fictional']}),{mode:0o600});
  const proof=path.join(dir,'fftt-fictional.reverified-2026-11-07T00.report.json');
  fs.writeFileSync(proof,JSON.stringify({format:'fftt-private-backup-report-v1',
    project:'copmkalfkkrkzheohwuc',backup:file,sha256:sha(fs.readFileSync(file)),
    verified:true,result:'LOCAL_VERIFIED',verification_time:'2026-11-07T22:08:00Z'}),{mode:0o600});
  const drive=path.join(home,'Library','CloudStorage','GoogleDrive-synthetic','My Drive');
  fs.mkdirSync(drive,{recursive:true});
  return {home,file,proof,drive};
}
function fakeHdiutil(cmd,args){
  if(args[0]==='create'){
    assert.ok(args.includes('-encryption')&&args.includes('AES-256')&&args.includes('-stdinpass'));
    assert.ok(args.includes('-srcfolder'));
    assert.equal(args.includes('fictional-passphrase'),false);
    fs.writeFileSync(args.at(-1),'SYNTHETIC TEST IMAGE BYTES',{mode:0o600});
    return {status:0};
  }
  if(args[0]==='isencrypted')return {status:0,stdout:'encrypted: yes\n'};
  if(args[0]==='verify')return {status:0,stdout:'verified\n'};
  throw Error('Unexpected fake hdiutil subcommand');
}
test('only accepts an owner-verified private backup with matching SHA-256',()=>{
  const fx=fixture();
  try{
    assert.equal(verifiedSource(fx.file).reportFile,fx.proof);
    fs.appendFileSync(fx.file,'tamper');
    assert.throws(()=>verifiedSource(fx.file),/No matching successful restore verification/);
  }finally{fs.rmSync(fx.home,{recursive:true,force:true});}
});
test('autodetects Google Drive File Provider folder without uploading',()=>{
  const fx=fixture();
  try{assert.deepEqual(findDriveRoots(fx.home),[fx.drive]);}
  finally{fs.rmSync(fx.home,{recursive:true,force:true});}
});
test('Google Drive receives only encrypted DMG bytes; original and verification report preserved',()=>{
  const fx=fixture(),original=fs.readFileSync(fx.file),printed=[];
  try{
    const result=copyEncryptedToDrive({backupFile:fx.file,home:fx.home,
      spawn:fakeHdiutil,now:new Date('2026-11-07T23:00:00Z'),logger:s=>printed.push(s)});
    assert.equal(result.local_checksum_verified,true);
    assert.equal(result.drive_sync,'UNCONFIRMED');
    assert.deepEqual(fs.readFileSync(fx.file),original);
    assert.deepEqual(fs.readFileSync(result.local_archive),fs.readFileSync(result.drive_folder_copy));
    assert.equal(path.dirname(result.drive_folder_copy),path.join(fx.drive,'FFTT Private Backups'));
    assert.equal(fs.readFileSync(result.drive_folder_copy,'utf8'),'SYNTHETIC TEST IMAGE BYTES');
    assert.equal(fs.readdirSync(path.join(fx.drive,'FFTT Private Backups')).length,1);
    assert.ok(printed.some(x=>x.includes('CLOUD SYNC: UNCONFIRMED')));
  }finally{fs.rmSync(fx.home,{recursive:true,force:true});}
});
test('failed disk-image encryption never writes plaintext or unverified data to Drive',()=>{
  const fx=fixture();
  const fail=(cmd,args)=>{
    if(args[0]==='create'){fs.writeFileSync(args.at(-1),'FAKE BAD IMAGE');return {status:0};}
    if(args[0]==='isencrypted')return {status:0,stdout:'encrypted: NO'};
    return {status:0};
  };
  try{
    assert.throws(()=>copyEncryptedToDrive({backupFile:fx.file,home:fx.home,
      spawn:fail,logger:()=>{}}),/did not confirm encryption/);
    assert.equal(fs.existsSync(path.join(fx.drive,'FFTT Private Backups')),false);
  }finally{fs.rmSync(fx.home,{recursive:true,force:true});}
});
