import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMyEvents} from '../contracts/gameday_api.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const event = role => ({
  event_id: 'd8c29f84-cc54-42f2-93e5-d4d0649b9709',
  name: 'FICTIONAL BRACKET TEST', date: '2026-11-08', lifecycle: 'draft',
  role, revision: 1, can_create: false, tables: 2, players: null, deletable: false,
});

test('bracket_manager is a valid independent event-scoped role, without organizer event privileges', () => {
  const [e] = parseMyEvents([event('bracket_manager')]);
  assert.equal(e.role, 'bracket_manager');
  assert.equal(e.players, null);
  assert.equal(e.deletable, false);
  assert.throws(() => parseMyEvents([{...event('bracket_manager'), players: 1}]));
  assert.throws(() => parseMyEvents([{...event('bracket_manager'), deletable: true}]));
  for (const role of ['organizer', 'scorekeeper']) assert.equal(parseMyEvents([event(role)])[0].role, role);
});

test('manager snapshot is isolated from account and registration-link metadata', () => {
  const sql = read('supabase/proposals/FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql');
  const start = sql.indexOf('function fftt_private.bracket_manager_snapshot_v1(');
  const end = sql.indexOf('\n$f$;', start);
  assert.ok(start > 0 && end > start);
  const snapshot = sql.slice(start, end);
  assert.match(snapshot, /staff_role_for_event\(p_event_id\) <> 'bracket_manager'/);
  assert.match(snapshot, /'staff', '\[\]'::jsonb/);
  assert.match(snapshot, /'registration_refs', '\[\]'::jsonb/);
  assert.doesNotMatch(snapshot, /u\.email|registration_links|service_role|private_key/);
});

test('bracket manager cannot rebuild existing brackets or receive organizer-only grants', () => {
  const sql = read('supabase/proposals/FFTT3_BRACKET_MANAGER_ROLE_20261030_DO_NOT_APPLY.sql');
  for (const marker of [
    "if v_rebuild and fftt_private.staff_role_for_event(p_event_id) = 'bracket_manager'",
    "if v_old is not null and fftt_private.staff_role_for_event(p_event_id) = 'bracket_manager'",
    "array['organizer','scorekeeper','bracket_manager']",
    "'organizer','scorekeeper','bracket_manager'",
  ]) assert.ok(sql.includes(marker), marker);
  for (const prohibited of ['set_visibility_v3(', 'set_lifecycle_v3(', 'set_registration_source_v5(', 'correct_result_v3(', 'forfeit_match_v3(']) {
    assert.ok(!sql.includes('function fftt_private.' + prohibited), prohibited);
  }
});

test('manager interface does not expose organizer-only tabs or correction controls', () => {
  const ui = read('app/staff_ui.mjs');
  const m = ui.match(/const BRACKET_MANAGER_TABS = (.*);/);
  assert.ok(m);
  for (const tab of ['championship','consolation','desk','finale']) assert.ok(m[1].includes("'"+tab+"'"));
  for (const tab of ['overview','players','results','staff']) assert.ok(!m[1].includes("'"+tab+"'"));
  assert.match(ui, /const org = isOrganizer\(\)/);
  assert.match(ui, /: isOrganizer\(\) \? h\('button'.*Rebuild \(replaces the bracket\)/s);
});

test('approved production domain trust cannot bleed into staging or arbitrary hosts', () => {
  const builder = read('tools/staging/build_export.py');
  const staff = read('app/staff.mjs');
  assert.match(builder, /fftt-\(\?:staff\|games\)/);
  assert.match(builder, /environment != 'production'/);
  assert.match(builder, /approvedHttpsOrigins': https_entries/);
  assert.match(staff, /fftt-games\.clslifestyle\.com/);
});
