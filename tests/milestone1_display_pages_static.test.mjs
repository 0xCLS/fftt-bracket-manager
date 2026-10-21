import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=name=>readFileSync(new URL('../rehearsals/m1/'+name,import.meta.url),'utf8');
const HOST='https://copmkalfkkrkzheohwuc.supabase.co';
const tvHtml=read('tv-display.html'),tv=read('tv-display.mjs');
const fbHtml=read('fallback-ops.html'),fb=read('fallback-ops.mjs');
const devHtml=read('device-staff.html'),dev=read('device-staff.mjs');
test('new rehearsal modules are syntactically valid JavaScript',()=>{
 for(const f of ['tv-display.mjs','fallback-ops.mjs','device-staff.mjs','device-check.mjs'])
  execFileSync(process.execPath,['--check',new URL('../rehearsals/m1/'+f,import.meta.url).pathname]);
});
test('TV board CSP allows only same-origin assets and the one development host',()=>{
 assert.match(tvHtml,/Content-Security-Policy/);
 assert.match(tvHtml,/default-src 'self'/);assert.match(tvHtml,/script-src 'self'/);
 assert.ok(tvHtml.includes('connect-src '+HOST+';'));
 assert.match(tvHtml,/object-src 'none'/);assert.match(tvHtml,/form-action 'none'/);
 assert.equal((tvHtml.match(/https?:\/\//g)||[]).length,1,'only the connect-src host appears');
});
test('TV board is anonymous, read-only, user-started and renders with textContent only',()=>{
 assert.doesNotMatch(tv,/Authorization|Bearer|localStorage|sessionStorage|indexedDB|innerHTML|insertAdjacentHTML|document\.write/);
 assert.doesNotMatch(tv,/method\s*:\s*['"]POST|submitScore|publish\s*\(|createUser|signIn|PKCE/i);
 assert.match(tv,/getAccessToken:\(\)=>\{throw/);
 assert.match(tv,/\$\('start'\)\.addEventListener\('click'/);
 assert.equal((tv.match(/display\.start\(/g)||[]).length,1,'the only start is inside the click handler');
 assert.ok(tv.indexOf('display.start(')>tv.indexOf("addEventListener('click'"));
});
test('fallback rehearsal page has no network capability at all',()=>{
 assert.ok(fbHtml.includes("connect-src 'none'"));
 assert.equal((fbHtml.match(/https?:\/\//g)||[]).length,0);
 assert.doesNotMatch(fb,/fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|innerHTML|import\(/);
 assert.doesNotMatch(fb,/submitScore|publish\s*\(|createUser|upload\s*\(|autoMerge/i);
 assert.match(fbHtml,/NO NETWORK/);assert.match(fbHtml,/NO AUTOMATIC MERGE/);
});
test('fallback rehearsal never claims to stop a real device',()=>{
 assert.match(fbHtml,/cannot stop any real device/);
 assert.match(fb,/did NOT stop any real device/);
});

test('device staff page is origin-gated, consent-gated, single-request and read-only',()=>{
 assert.ok(devHtml.includes("connect-src 'self' "+HOST+';'));
 assert.match(devHtml,/id="requestLink" type="button" disabled/);
 assert.match(devHtml,/id="consent" type="checkbox"/);
 assert.match(dev,/assessMilestone1DeviceReadiness/);
 assert.equal((dev.match(/session\.begin\(/g)||[]).length,1);
 assert.ok(dev.indexOf('session.begin(')>dev.indexOf("addEventListener('click'"));
 assert.match(dev,/requested=true;\$\('requestLink'\)\.disabled=true/);
 assert.match(dev,/history\.replaceState\(null,'',window\.location\.pathname\)/);
 // the callback is scrubbed before the first await
 assert.ok(dev.indexOf('history.replaceState')<dev.indexOf('await '));
 assert.doesNotMatch(dev,/localStorage|indexedDB|innerHTML|submitScore|scoreSubmit|publish\s*\(|createUser|method\s*:\s*['"]POST/);
 assert.doesNotMatch(dev,/fftttesting|@yahoo|@gmail/i);
 assert.match(dev,/session\.suspend\(\)/);assert.match(dev,/session\.resume\(\)/);
 assert.match(dev,/device-origins\.local\.json/);
 assert.match(dev,/function signedOut\(message\)\{[^}]*session\?\.pause\(\)/s,'signed out must also clear the session');
 assert.match(dev,/if\(document\.hidden\)return;/,'an interrupted resume leaves the suspended session alone');
});
test('a private approved-origin file can never be committed',()=>{
 const ignore=readFileSync(new URL('../.gitignore',import.meta.url),'utf8');
 assert.match(ignore,/rehearsals\/m1\/device-origins\.local\.json/);
});
