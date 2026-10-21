import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const page=readFileSync(new URL('../rehearsals/m1/hosted-pkce.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../rehearsals/m1/hosted-pkce.mjs',import.meta.url),'utf8');
const transport=readFileSync(new URL('../contracts/milestone1_pkce_supabase_transport.mjs',import.meta.url),'utf8');

test('isolated hosted PKCE trial syntax is valid JavaScript',()=>{
 execFileSync(process.execPath,['--check',new URL('../rehearsals/m1/hosted-pkce.mjs',import.meta.url).pathname]);
});
test('hosted trial is pinned to exact development localhost and manual opt-in',()=>{
 assert.match(source,/window\.location\.origin==='http:\/\/localhost:3000'/);
 assert.match(source,/window\.location\.pathname==='\/rehearsals\/m1\/hosted-pkce\.html'/);
 assert.match(source,/\$\('consent'\)\.checked/);
 assert.match(source,/\$\('requestLink'\)\.addEventListener\('click'/);
 assert.match(page,/id="requestLink" type="button" disabled/);
 assert.match(page,/id="consent" type="checkbox"/);
 assert.equal((source.match(/session\.begin\(/g)||[]).length,1);
 assert.ok(source.indexOf("session.begin(address)")>source.indexOf("addEventListener('click'"));
 assert.ok(source.includes("requested=true;$('requestLink').disabled=true"));
 assert.match(source,/allowSyntheticAuthNetwork:local/);
 assert.match(source,/history\.replaceState\(null,'',window\.location\.pathname\)/);
 assert.doesNotMatch(source,/fftttesting-scorea@yahoo\.com/);
 assert.doesNotMatch(page,/fftttesting-scorea@yahoo\.com/);
});

test('only the existing-account, read-only transport is reachable',()=>{
 assert.match(transport,/create_user:false/);
 assert.doesNotMatch(source,/submitScore|scoreSubmit|\bpublish\s*\(|createUser/);
 assert.match(page,/NO SCORES/);
 assert.match(page,/connect-src https:\/\/copmkalfkkrkzheohwuc\.supabase\.co/);
});
test('switching tabs does not cancel the pending PKCE email verifier',()=>{
 assert.match(source,/const privacyPause=\(\)=>\{/);
 assert.match(source,/session\.pause\(\)/);
 assert.match(source,/visibilitychange/);
 assert.match(source,/session\.signOut\(\)/);
 assert.ok(!source.slice(source.indexOf('const privacyPause')).includes("clear();"));
});
