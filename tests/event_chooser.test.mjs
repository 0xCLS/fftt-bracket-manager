import test from 'node:test';
import assert from 'node:assert/strict';
import {organizeEventChoices,searchEventChoices} from '../app/event_chooser.mjs';
const E=(id,lifecycle,date,name=id,role='bracket_manager')=>({eventId:id,lifecycle,date,name,role});
test('last opened is prominent but never duplicated, and lifecycle groups retain all events',()=>{
 const list=[E('old','archived','2025-01-01'),E('now','active','2026-11-22'),E('past','complete','2026-08-23'),E('next','draft','2027-01-02')];
 const g=organizeEventChoices(list,'old');
 assert.deepEqual(g.map(x=>x.id),['recent','current','planned','completed']);
 assert.deepEqual(g.flatMap(x=>x.events.map(e=>e.eventId)),['old','now','next','past']);
 assert.equal(list.length,4);
});
test('active events first, most recent first, completed/archived separated',()=>{
 const g=organizeEventChoices([E('a','active','2026-11-22'),E('b','active','2026-11-24'),E('c','complete','2026-08-23'),E('d','archived','2025-01-01')],null);
 assert.deepEqual(g.map(x=>x.id),['current','completed','archived']);
 assert.deepEqual(g[0].events.map(e=>e.eventId),['b','a']);
});
test('search by name, date, lifecycle and role; no matches produce empty groups',()=>{
 const g=organizeEventChoices([E('a','active','2026-11-22','FFTT 3','organizer'),E('b','complete','2026-08-23','Summer','bracket_manager')],'b');
 assert.deepEqual(searchEventChoices(g,'fFtT').flatMap(x=>x.events.map(e=>e.eventId)),['a']);
 assert.deepEqual(searchEventChoices(g,'manager').flatMap(x=>x.events.map(e=>e.eventId)),['b']);
 assert.deepEqual(searchEventChoices(g,'2026-11').flatMap(x=>x.events.map(e=>e.eventId)),['a']);
 assert.deepEqual(searchEventChoices(g,'nothing'),[]);
 assert.equal(g.length,2);
});
test('duplicate IDs and empty roster safely handled',()=>{
 assert.deepEqual(organizeEventChoices([E('a','active','2026-11-22'),E('a','active','2026-11-22')],null).flatMap(g=>g.events.map(e=>e.eventId)),['a']);
 assert.deepEqual(organizeEventChoices([],null),[]);
});
