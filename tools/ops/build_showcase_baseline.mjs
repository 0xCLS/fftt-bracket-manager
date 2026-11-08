/** Owner-local, one-time installer fragment. Never print or commit the generated file. */
import fs from 'node:fs';
import crypto from 'node:crypto';
const [source,destination] = process.argv.slice(2);
if (!source || !destination || !destination.startsWith('/private/tmp/')) throw Error('Specify backup and an output path in /private/tmp');
const raw=fs.readFileSync(source);
const expected='c16a477419af1f277792665a0e9ca94bd513effc66de1c7639dab51da84a0c44';
if(crypto.createHash('sha256').update(raw).digest('hex')!==expected) throw Error('Backup checksum mismatch');
const backup=JSON.parse(raw), eid='e6bd40cf-4107-43ea-8c87-057dc38ef31b', pub='9c25613c-6543-4d6c-84cf-97ba49017509';
const scoped=k=>backup.tables[k].rows.filter(x=>x.event_id===eid);
const ev=backup.tables.events.rows.find(x=>x.id===eid), players=scoped('players'), brackets=scoped('brackets'), matches=scoped('matches'), reviews=scoped('consolation_reviews');
const counts=s=>matches.filter(m=>m.status===s).length;
if(backup.project!=='copmkalfkkrkzheohwuc'||!ev||ev.public_id!==pub||!ev.synthetic_only||ev.lifecycle!=='active'||!ev.public_visible||ev.bracket_generation!==1||players.length!==20||!players.every(p=>p.checked_in)||brackets.length!==2||matches.length!==46||counts('complete')!==14||counts('bye')!==18||counts('pending')!==14||scoped('doubles_finale').length) throw Error('Backup fixture does not match required baseline');
const pids=new Set(players.map(p=>p.id)), mids=new Set(matches.map(m=>m.id));
if(new Set(players.map(p=>p.seed_order)).size!==20||matches.some(m=>['player_1_id','player_2_id','winner_id'].some(k=>m[k]&&!pids.has(m[k]))||(m.next_match_id&&!mids.has(m.next_match_id)))) throw Error('Invalid fixture references');
const byId=new Map(players.map(p=>[p.id,p.display_name]));
for(const [number, names] of [[1,['Morgan Reed','Alexis Monroe']],[2,['Finley Quinn','Dana Winslow']]]) {
 const m=matches.find(x=>x.status==='pending'&&x.table_number===number);
 if(!m||![m.player_1_id,m.player_2_id].every(id=>names.includes(byId.get(id)))) throw Error('Expected playing matches differ');
}
const pick=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o[k]??null]));
const eventFields='event_name event_date lifecycle table_count public_visible champ_best_of champ_points champ_final_best_of champ_final_points cons_best_of cons_points cons_final_best_of cons_final_points doubles_best_of doubles_points'.split(' ');
const playerFields='id display_name rating rating_status checked_in first_champ_loss seed_order source rating_confirmed'.split(' ');
const bracketFields='id status consolation_review_completed'.split(' ');
const matchFields='id player_1_id player_2_id winner_id game_scores table_number status best_of points_to_win next_match_id next_match_slot'.split(' ');
const reviewFields='event_id player_id first_loss_match_id review_state reviewed_at'.split(' ');
const fixture={event:pick(ev,eventFields),players:players.map(x=>pick(x,playerFields)),brackets:brackets.map(x=>pick(x,bracketFields)),matches:matches.map(x=>pick(x,matchFields)),reviews:reviews.map(x=>pick(x,reviewFields))};
const encoded=Buffer.from(JSON.stringify(fixture)).toString('base64');
const sql=`do $guard$ begin if not exists (select 1 from fftt_private.events where id='${eid}'::uuid and public_id='${pub}'::uuid and synthetic_only is true) then raise exception 'Showcase identity mismatch'; end if; end $guard$;\ninsert into fftt_private.showcase_reset_baseline(fixture,archive_sha256) values (pg_catalog.convert_from(pg_catalog.decode('${encoded}','base64'),'UTF8')::jsonb,'${expected}');\n`;
fs.writeFileSync(destination,sql,{mode:0o600,flag:'wx'});
console.log('Validated showcase fixture; wrote protected installer fragment.');
