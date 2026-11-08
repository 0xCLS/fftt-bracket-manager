/** The scoring-permissions rollback restores the previously installed function bodies exactly (fingerprints) and
 * removes only the new functions. Disposable database only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHostedEquivalentDb} from './hosted_equivalent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'supabase/proposals/STAFF_SCORING_PERMISSIONS_ROLLBACK_DO_NOT_APPLY.sql'), 'utf8');
const REPLACED = ['fftt_private.game_progress_save_v1(uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,integer,integer,text)',
  'fftt_private.correct_result_v3(uuid,uuid,bigint,uuid,text,text)', 'public.fftt_correct_result_v3(uuid,uuid,bigint,uuid,text,text)',
  'fftt_private.record_doubles_result_v3(uuid,integer,text)'];
const NEW = ['public.fftt_doubles_desk_v1(uuid)', 'fftt_private.doubles_desk_v1(uuid)',
  'public.fftt_correct_doubles_result_v1(uuid,integer,text,integer,text,text)', 'fftt_private.correct_doubles_result_v1(uuid,integer,text,integer,text,text)'];

test('rollback restores the exact previous function bodies and privileges, and removes the new functions', {timeout: 240000}, async () => {
  const state = async db => Promise.all(REPLACED.map(async f => (await db.admin(`select md5(pg_get_functiondef('${f}'::regprocedure)) m, proacl::text a from pg_proc where oid='${f}'::regprocedure`))[0]));
  const original = await createHostedEquivalentDb();
  const target = await createHostedEquivalentDb({corrections: true});
  try {
    const before = await state(original);
    assert.notDeepEqual((await state(target)).map(x => x.m), before.map(x => x.m), 'the migration really changed the bodies');
    await target.db.exec(ROLLBACK);
    const after = await state(target);
    assert.deepEqual(after.map(x => x.m), before.map(x => x.m), 'every replaced body is byte-identical to the previous version');
    assert.deepEqual(after.map(x => x.a), before.map(x => x.a), 'privileges are unchanged');
    for (const f of NEW) assert.equal((await target.admin(`select to_regprocedure('${f}') is not null as e`))[0].e, false, `${f} removed`);
    assert.equal((await target.admin("select count(*)::int n from pg_proc where proname='fftt_correct_result_v3' and pronamespace='public'::regnamespace"))[0].n, 1);
  } finally { await original.db.close(); await target.db.close(); }
});
