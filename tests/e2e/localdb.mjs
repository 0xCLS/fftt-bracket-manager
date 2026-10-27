/** Test-only: the REAL FFTT SQL (B1-B2d, V2, game-day V3) in a throw-away in-process PostgreSQL (PGlite).
 * Mimics what Supabase provides around it: roles, the `auth` schema and PostgREST's per-request
 * transaction (`set local role`, JWT claims in GUCs). No network, no hosted project, no secrets.
 * Real GoTrue + multi-connection concurrency are covered separately by the CI `disposable-db` job. */
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SQL_FILES = [
  'supabase/migrations/20261008000100_phase1b_foundation.sql',
  'supabase/migrations/20261008000200_restrict_auto_rls_helper.sql',
  'supabase/migrations/20261008000300_b2a_staff_read_api.sql',
  'supabase/migrations/20261008000400_b2b_transactional_score.sql',
  'supabase/migrations/20261009000100_b2d_staff_grants.sql',
  'supabase/proposals/MILESTONE1_DURABLE_SCORING_V2_DO_NOT_APPLY.sql',
  'supabase/proposals/GAMEDAY_TOURNAMENT_V3_STAGING.sql',
  'supabase/proposals/GAMEDAY_TOURNAMENT_V4_STAGING.sql',
  'supabase/proposals/GAMEDAY_TOURNAMENT_V5_STAGING.sql',
];

const AUTH_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users(
  id uuid primary key, email text, is_anonymous boolean not null default false,
  email_confirmed_at timestamptz default now(), deleted_at timestamptz, banned_until timestamptz,
  instance_id uuid, aud text, role text, created_at timestamptz default now(), updated_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant execute on functions to public;
`;

export async function createLocalDb({sqlFiles = SQL_FILES} = {}) {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  for (const f of sqlFiles) await db.exec(fs.readFileSync(path.isAbsolute(f) ? f : path.join(ROOT, f), 'utf8'));
  return new LocalDb(db);
}

export class RpcError extends Error {
  constructor(code, message, detail) { super(message); this.name = 'RpcError'; this.code = code; this.detail = detail ?? null; }
}

const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

export class LocalDb {
  constructor(db) { this.db = db; this.users = new Map(); }
  /** Trusted administrative setup (what the owner does in the SQL editor). Fictional accounts only. */
  async addUser(email, {platformOrganizer = false} = {}) {
    const id = crypto.randomUUID();
    await this.db.query(
      `insert into auth.users(id,email,aud,role,instance_id) values ($1,$2,'authenticated','authenticated','00000000-0000-0000-0000-000000000000')`, [id, email]);
    if (platformOrganizer) await this.db.query(`insert into fftt_private.platform_organizers(user_id) values ($1)`, [id]);
    this.users.set(email, id);
    return id;
  }
  async admin(sql, params = []) { return (await this.db.query(sql, params)).rows; }
  /** One PostgREST-style request: own transaction, role, claims. `userId` null = anonymous. */
  async rpc(userId, fn, args = {}, {rows = false} = {}) {
    const names = Object.keys(args);
    const values = names.map(k => {
      const v = args[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const argList = names.map((k, i) => `${k} => $${i + 1}`).join(', ');
    // table-returning functions (the Match Desk) are read as rows, like PostgREST does
    const call = rows ? `select * from public.${fn}(${argList})` : `select public.${fn}(${argList}) as r`;
    return this.#asRole(userId, async tx => {
      const res = await tx.query(call, values);
      return rows ? res.rows : (res.rows[0]?.r ?? null);
    });
  }
  /** Anonymous GET of the public read model. */
  async publicTournaments() {
    // PostgREST serializes `date` as 'YYYY-MM-DD'; PGlite would hand back a Date object, so cast here.
    return this.#asRole(null, async tx => (await tx.query(
      'select event_id, event_name, event_date::text as event_date, status, revision, tables, updated_at, finale, brackets from public.fftt_public_tournament_v1 order by event_name')).rows);
  }
  async #asRole(userId, work) {
    const role = userId ? 'authenticated' : 'anon';
    const claims = userId ? {sub: userId, role: 'authenticated', aud: 'authenticated'} : {role: 'anon'};
    try {
      return await this.db.transaction(async tx => {
        await tx.query(`set local role ${role}`);
        await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
          [JSON.stringify(claims), userId ?? '']);
        return work(tx);
      });
    } catch (e) {
      if (e?.code !== undefined || e?.message) {
        throw new RpcError(e.code ?? 'unknown', e.message, e.detail);
      }
      throw e;
    }
  }
  static isUuid = isUuid;
}
