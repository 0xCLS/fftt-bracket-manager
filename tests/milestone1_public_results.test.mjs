import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPublishedResults,PublicProjectionError} from '../contracts/milestone1_public_results.mjs';
const E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M=()=>({event_id:E,match_id:'C-0-0',bracket:'championship',round:0,slot:0,player_1_name:'Synthetic Alpha',player_2_name:'Synthetic Beta',winner_name:'Synthetic Alpha',game_scores:'11-8,11-9',status:'complete'});
const V=()=>({event_id:E,event_name:'Synthetic event',event_date:'2099-11-22',status:'active',updated_at:'2099-11-22T14:00:00Z',brackets:[{name:'championship',matches:[M()]}]});
const fail=x=>assert.throws(()=>projectPublishedResults(x),PublicProjectionError);
test('safe public presentation strips all IDs, displays results, and freezes records',()=>{
 const row=projectPublishedResults([V()]);assert.equal(row[0].name,'Synthetic event');
 assert.equal(row[0].brackets[0].matches[0].players,'Synthetic Alpha vs Synthetic Beta');
 assert.equal(row[0].brackets[0].matches[0].winner,'Synthetic Alpha');
 assert.equal(JSON.stringify(row).includes(E),false);
 assert.equal(JSON.stringify(row).includes('C-0-0'),false);
 assert.equal(Object.isFrozen(row[0].brackets[0].matches),true);
});
test('empty projection is a valid no-publication state',()=>assert.deepEqual(projectPublishedResults([]),[]));
test('reject private or accidental extra fields at any level',()=>{
 let a=V();a.email='private@sample.org';fail([a]);
 a=V();a.brackets[0].rating=5;fail([a]);
 a=V();a.brackets[0].matches[0].phone='555';fail([a]);
});
test('deny mismatched event/bracket, malformed rows, and forged winners',()=>{
 let a=V();a.brackets[0].matches[0].event_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';fail([a]);
 a=V();a.brackets[0].matches[0].bracket='consolation';fail([a]);
 a=V();a.brackets[0].matches[0].winner_name='Not a participant';fail([a]);
 fail([{name:'untrusted'}]); fail(null);
});
test('deny excessive rows, duplicate brackets and oversized text',()=>{
 fail(Array(21).fill(V()));let a=V();a.brackets.push({...a.brackets[0]});fail([a]);
 a=V();a.brackets[0].matches=Array(129).fill(M());fail([a]);
 a=V();a.brackets[0].matches[0].player_1_name='x'.repeat(121);fail([a]);
});
test('text is data, not markup; renderer must only use textContent',()=>{
 const a=V();a.brackets[0].matches[0].player_2_name='<img src=x onerror=alert(1)>';
 const result=projectPublishedResults([a]);
 assert.ok(result[0].brackets[0].matches[0].players.includes('<img'));
 assert.equal(Object.keys(result[0]).includes('event_id'),false);
});
