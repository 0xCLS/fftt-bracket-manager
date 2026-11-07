import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeGameProgress} from '../contracts/gameday_game_progress.mjs';
import {projectPublicTournaments, PublicProjectionError} from '../contracts/gameday_public.mjs';

const E = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M = () => ({
  match_id:'championship-c-0-0', bracket:'championship',round:0,slot:0,
  player_1_name:'Ada Quill',player_2_name:'Ben Marlow',winner_name:null,
  game_scores:'',status:'pending',table_number:1,phase:'playing',best_of:3,points_to_win:11,
});
const V = () => ({event_id:E,event_name:'Fictional tournament',event_date:'2099-11-22',
  status:'active',revision:5,tables:2,updated_at:'2099-11-22T14:00:00Z',finale:null,
  brackets:[{name:'championship',matches:[M()]}]});
const parse = row => projectPublicTournaments([row])[0].championship[0];
const invalid = row => assert.throws(() => projectPublicTournaments([row]),PublicProjectionError);

test('completed prefix: 1-0 then 1-1 then 2-1, and 2-0 never needs Game 3', () => {
  const a=summarizeGameProgress([[11,7]],3,11);
  assert.deepEqual(a.won,[1,0]); assert.equal(a.nextGame,2); assert.equal(a.decided,false);
  const b=summarizeGameProgress([[11,7],[8,11]],3,11);
  assert.deepEqual(b.won,[1,1]); assert.equal(b.nextGame,3);
  const c=summarizeGameProgress([[11,7],[8,11],[11,9]],3,11);
  assert.deepEqual(c.won,[2,1]); assert.equal(c.winnerIndex,0);assert.equal(c.nextGame,null);
  const d=summarizeGameProgress([[11,7],[11,5]],3,11);
  assert.deepEqual(d.won,[2,0]);assert.equal(d.decided,true);assert.equal(d.text,'11-7, 11-5');
  const bo1=summarizeGameProgress([[22,20]],1,21);
  assert.equal(bo1.decided,true);assert.equal(bo1.winnerIndex,0);
  const bo5=summarizeGameProgress([[11,7],[7,11],[11,3],[9,11],[11,7]],5,11);
  assert.deepEqual(bo5.won,[3,2]);assert.equal(bo5.decided,true);
});
test('reject invalid game, deuce, trailing score and extra games after match decision', () => {
  const cases=[[[11,10]],[[12,9]],[[9,11],[8,11],[11,7]],[[11,7],[11,8],[11,5]],
    [[11,-1]],[[100,98]],[[11,11]],[[11,7],[11,8],[8,11]]];
  for(const g of cases) assert.equal(summarizeGameProgress(g,3,11).ok,false,JSON.stringify(g));
  assert.equal(summarizeGameProgress([[22,20],[9,21]],1,21).ok,false);
});
test('anonymous projection only accepts verified published progress, and distinguishes no/legacy/official', () => {
  const row=V();const m=row.brackets[0].matches[0];
  delete m.game_progress;
  assert.equal(parse(row).progress,undefined,'old server has no progress contract');
  m.game_progress=null;assert.equal(parse(row).progress,null,'server reports no completed games');
  m.game_progress={games:[[11,7],[8,11]],version:2,epoch:0,updated_at:'2099-11-22T14:00:00Z'};
  assert.deepEqual(parse(row).progress.won,[1,1]);
  m.game_progress={games:[[11,7],[11,9]],version:2,epoch:0,updated_at:'2099-11-22T14:00:00Z'};
  assert.equal(parse(row).progress.decided,true);
  m.status='complete';m.winner_name=m.player_1_name;m.game_scores='11-7, 11-9';
  m.game_progress=null;assert.equal(parse(row).progress,null,'official match supersedes interim');
  m.game_progress={games:[[11,7]],version:1,epoch:0,updated_at:'2099-11-22T14:00:00Z'};
  invalid(row);
});
test('reject leaked fields, unverified/invalid payloads, stale malformed revisions and forged scores',()=>{
  const mutate=(fn)=>{const x=V();x.brackets[0].matches[0].game_progress={games:[[11,7]],version:1,epoch:0,updated_at:'2099-11-22T14:00:00Z'};fn(x.brackets[0].matches[0].game_progress,x.brackets[0].matches[0],x);invalid(x);};
  mutate(p=>{p.email='private@example.invalid';});
  mutate(p=>{p.rating=4;});
  mutate(p=>{p.games=[[11,9],[11,8],[11,6]];});
  mutate(p=>{p.games=[[11,10]];});
  mutate(p=>{p.games=[['11',7]];});
  mutate(p=>{p.version=-1;});
  mutate(p=>{p.updated_at='not a timestamp';});
  mutate((p,m)=>{m.best_of=null;m.points_to_win=null;});
  mutate((p,m)=>{m.phase='done';m.status='complete';});
  mutate((p,m)=>{m.internal_rating=5;});
});
