#!/usr/bin/env node
/** Prints the schema fingerprint of a database built from the repository's SQL chain (offline, PGlite), before or after the in-place
 * launch upgrade. Compare each line with the output of tools/ops/schema_fingerprint.sql run on the hosted project:
 *   node tools/ops/local_schema_fingerprint.mjs            -> what the hosted project must look like BEFORE the migration
 *   node tools/ops/local_schema_fingerprint.mjs --upgraded -> what it must look like AFTER the migration
 * Add --lines to also print every fingerprinted line (to diff a mismatch). Needs `npm ci` in tests/e2e. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalDb} from '../../tests/e2e/localdb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = await createLocalDb({upgraded: process.argv.includes('--upgraded')});
const rows = await db.admin(fs.readFileSync(path.join(ROOT, 'tools/ops/schema_fingerprint.sql'), 'utf8'));
for (const r of rows) {
  console.log(`${r.kind.padEnd(11)} ${String(r.n).padStart(4)}  ${r.fingerprint}`);
  if (process.argv.includes('--lines')) console.log(r.lines.split('\n').map(l => '    ' + l).join('\n'));
}
await db.db.close();
