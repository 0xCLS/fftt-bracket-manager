#!/usr/bin/env bash
# Compile one-project promotion SQL on an existing *populated disposable local* PostgreSQL DB.
# Does not access hosted Supabase; no secrets, actual sign-ups, external endpoints or purchases.
set -euo pipefail
db_name="fftt_inplace_ci_${GITHUB_RUN_ID:-$$}"
tmp="$(mktemp -d)"
made=0
PSQL=(psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres)
cleanup() {
  if [ "$made" -eq 1 ]; then
    "${PSQL[@]}" -d postgres -c "drop database ${db_name};" >/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT
python3 tools/release/build_single_project_upgrade.py --out "$tmp/promotion.sql"
"${PSQL[@]}" -d postgres -c "create database ${db_name};"
made=1
"${PSQL[@]}" -d "$db_name" <<'STUB'
create schema auth;
create table auth.users (
  id uuid primary key, email text, is_anonymous boolean not null default false,
  email_confirmed_at timestamptz default now(), deleted_at timestamptz,
  banned_until timestamptz, instance_id uuid, aud text, role text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant execute on functions to public;
STUB
sources=(
 supabase/migrations/20261008000100_phase1b_foundation.sql
 supabase/migrations/20261008000200_restrict_auto_rls_helper.sql
 supabase/migrations/20261008000300_b2a_staff_read_api.sql
 supabase/migrations/20261008000400_b2b_transactional_score.sql
 supabase/migrations/20261009000100_b2d_staff_grants.sql
 supabase/proposals/MILESTONE1_DURABLE_SCORING_V2_DO_NOT_APPLY.sql
 supabase/proposals/GAMEDAY_TOURNAMENT_V3_STAGING.sql
 supabase/proposals/GAMEDAY_TOURNAMENT_V4_STAGING.sql
 supabase/proposals/GAMEDAY_TOURNAMENT_V5_STAGING.sql
)
for file in "${sources[@]}"; do
  "${PSQL[@]}" -d "$db_name" -f "$file" > /dev/null
done
"${PSQL[@]}" -d "$db_name" -f tests/gameday_single_project_pre.sql > /dev/null
"${PSQL[@]}" -d "$db_name" -f "$tmp/promotion.sql" > /dev/null
"${PSQL[@]}" -d "$db_name" -f tests/gameday_single_project_post.sql
echo "PASS: source-pinned in-place SQL candidate against populated disposable PostgreSQL"
