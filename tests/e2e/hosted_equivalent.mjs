/** Test-only: a disposable database layered exactly like the hosted project (B1-B2d, V2-V5, role, delegation,
 * registration, V6, then the reviewed showcase-reset migration), optionally with the correction-permissions migration.
 * Never connects to Supabase. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalDb, SQL_FILES} from './localdb.mjs';
import {APPLIED_PRE_V6_LAYERS} from '../../tools/ops/restore_verify_helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const V6 = 'supabase/proposals/GAMEDAY_V6_GAME_PROGRESS_DO_NOT_APPLY.sql';
export const RESET = 'supabase/migrations/20261108114950_showcase_reset.sql';
export const CORRECTIONS = 'supabase/migrations/20261108150000_staff_scoring_permissions.sql';
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** SQL installed on the hosted project AFTER the Nov 8 layers, in deployment order. Each source is pinned by its git blob id so
 * a changed or substituted file can never silently become the "current hosted" baseline. Disposable databases only.
 *  - 20261109170000 fftt_rehearsal_walkover_withdrawal (blob pinned in tools/ops/compose_walkover_install.mjs)
 *  - 20261110090000 fftt_staff_rename_and_withdrawal_eligibility (the two proposals below, installed from PR #84 source 696dcf0) */
export const INSTALLED_AFTER_NOV8_LAYERS = Object.freeze([
  {file: 'supabase/proposals/FFTT3_REHEARSAL_WALKOVER_WITHDRAWAL_20261109_DO_NOT_APPLY.sql', blob: '1d545444bf4aa2c8f737f6c632bc599812b8fe27'},
  {file: 'supabase/proposals/FFTT3_COMPLETED_EVENT_RENAME_20261109_DO_NOT_APPLY.sql', blob: 'c71f2062ed7f7e23b8cdc112db9ad6553b5ee923'},
  {file: 'supabase/proposals/FFTT3_PREPLAY_WITHDRAWAL_ELIGIBILITY_20261110_DO_NOT_APPLY.sql', blob: '34bc471acc92cac0704f11a55b53819f371fbd25'},
]);
const gitBlob = text => crypto.createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0' + text).digest('hex');

/** `installed: true` additionally layers the SQL installed on hosted after Nov 8 (current production schema). Default is unchanged,
 * because existing tests install those same proposals themselves on top of the Nov 8 baseline. */
export async function createHostedEquivalentDb({corrections = false, installed = false} = {}) {
  if (installed && !corrections) throw new Error('The installed layers sit on top of the scoring-permissions layer');
  const local = await createLocalDb({sqlFiles: SQL_FILES.filter(f => f !== V6), upgraded: true});
  for (const layer of APPLIED_PRE_V6_LAYERS) await local.db.exec(read(layer));
  await local.db.exec(read(V6));
  await local.db.exec(read(RESET));
  if (corrections) await local.db.exec(read(CORRECTIONS));
  if (installed) for (const {file, blob} of INSTALLED_AFTER_NOV8_LAYERS) {
    const sql = read(file);
    if (gitBlob(sql) !== blob) throw new Error('Installed-layer source differs from its pinned provenance: ' + file);
    await local.db.exec(sql);
  }
  return local;
}
