import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=n=>readFileSync(new URL('../rehearsals/m1/'+n,import.meta.url),'utf8');
const html=read('staff-login.html'),js=read('staff-login.mjs'),css=read('staff-login.css');
const HOST='https://copmkalfkkrkzheohwuc.supabase.co';
test('the login module is valid JavaScript and the shipped origin profile is empty (fail closed)',()=>{
 execFileSync(process.execPath,['--check',new URL('../rehearsals/m1/staff-login.mjs',import.meta.url).pathname]);
 assert.deepEqual(JSON.parse(read('origin-profile.json')),{environment:null,approvedPublicStaticOrigins:[],approvedHttpsOrigins:[]});
});
test('CSP forbids inline code, framing helpers, forms posts, objects and unknown origins',()=>{
 const csp=html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
 assert.equal(csp,"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' "+HOST+"; img-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
 assert.doesNotMatch(csp,/unsafe-/);
 assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)[^>]*>/i,'no inline script');
 assert.doesNotMatch(html,/\son[a-z]+=|\sstyle=/i,'no inline handlers or styles');
 assert.equal([...html.matchAll(/https?:\/\/[^\s"'<>;]+/g)].map(m=>m[0]).filter(u=>u!==HOST).length,0,'no other remote URL');
 assert.doesNotMatch(css,/@import|url\(/i);
 assert.match(html,/name="referrer" content="no-referrer"/);
 assert.match(html,/name="robots" content="noindex,nofollow"/);
});
test('the form never posts or navigates and offers password-manager and autofill hints',()=>{
 const form=html.match(/<form[^>]*>/)[0];
 assert.doesNotMatch(form,/\baction=|\bmethod=/i);
 assert.match(form,/novalidate/);
 assert.match(html,/id="password"[^>]*type="password"[^>]*autocomplete="current-password"/);
 assert.match(html,/id="email"[^>]*autocomplete="username"/);
 assert.match(html,/id="code"[^>]*autocomplete="one-time-code"/);
 assert.doesNotMatch(html,/\bvalue="/i,'nothing is prefilled');
 assert.match(html,/width=device-width,initial-scale=1/);
});
test('hosted sign-in is off in this build and the password is cleared before the request',()=>{
 assert.match(js,/const HOSTED_PASSWORD_AUTH_ENABLED=false;/);
 assert.match(js,/__FFTT_SYNTHETIC_PASSWORD_MOCK__===true/);
 const clearAt=js.indexOf("$('password').value='';");
 const signInAt=js.indexOf('session.signIn(');
 assert.ok(clearAt>0&&signInAt>clearAt,'the field is emptied before the sign-in call');
 assert.equal((js.match(/session\.signIn\(/g)||[]).length,1);
 assert.match(js,/\$\('signIn'\)\.disabled=!networkAllowed/);
});
test('no unsafe rendering, storage, logging or registration in the page script',()=>{
 for(const banned of ['innerHTML','insertAdjacentHTML','document.write','eval(','new Function','localStorage','indexedDB',
  'console.','signUp','/signup','service_role','sb_secret','location.hash','location.search','history.pushState'])
  assert.equal(js.includes(banned),false,banned);
 assert.equal(/sessionStorage/.test(js),true,'only via the vault and the readiness probe');
 assert.equal((js.match(/window\.sessionStorage/g)||[]).length,2);
 for(const bad of [/[\w.+-]+@(?!example\.)[\w-]+\.[a-z]{2,}/,/password\s*[:=]\s*['"][^'"]{4,}/i])
  assert.doesNotMatch(js+html,bad);
 // only the provider (through the transport) and the same-origin profile are ever fetched
 assert.deepEqual([...js.matchAll(/fetch\(([^)]*)\)/g)].map(m=>m[1].split(',')[0]),["'./origin-profile.json'",'url']);
});
test('sign-out paths exist for this device and for every device of the account',()=>{
 assert.match(js,/session\.signOut\(\{global\}\)/);
 assert.match(js,/leave\(false\)/);assert.match(js,/leave\(true\)/);
 assert.match(html,/id="signOutAll"/);
});
test('backgrounding and offline drop private views before anything else',()=>{
 assert.match(js,/function background\(\)\{[^}]*supervisor\.pause\('backgrounded'\)[^}]*session\.suspend\(\)/s);
 assert.match(js,/addEventListener\('offline'/);assert.match(js,/addEventListener\('visibilitychange'/);
});
