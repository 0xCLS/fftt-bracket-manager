/** Test-only: a disposable database layered exactly like the hosted project (B1-B2d, V2-V5, role, delegation,
 * registration, V6, then the reviewed showcase-reset migration), optionally with the correction-permissions migration.
 * Never connects to Supabase. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalDb, SQL_FILES} from './localdb.mjs';
import {APPLIED_PRE_V6_LAYERS} from '../../tools/ops/restore_verify_helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const V6 = 'supabase/proposals/GAMEDAY_V6_GAME_PROGRESS_DO_NOT_APPLY.sql';
export const RESET = 'supabase/migrations/20261108114950_showcase_reset.sql';
export const CORRECTIONS = 'supabase/migrations/20261108150000_staff_scoring_permissions.sql';
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

export async function createHostedEquivalentDb({corrections = false} = {}) {
  const local = await createLocalDb({sqlFiles: SQL_FILES.filter(f => f !== V6), upgraded: true});
  for (const layer of APPLIED_PRE_V6_LAYERS) await local.db.exec(read(layer));
  await local.db.exec(read(V6));
  await local.db.exec(read(RESET));
  if (corrections) await local.db.exec(read(CORRECTIONS));
  return local;
}
