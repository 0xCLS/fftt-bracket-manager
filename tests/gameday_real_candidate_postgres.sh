#!/usr/bin/env bash
# CI-only local PostgreSQL proof. No hosted endpoints, credentials, or real FFTT data.
set -euo pipefail
db_name="fftt_real_candidate_${GITHUB_RUN_ID:-$$}"
candidate_dir="$(mktemp -d)"
created_db=0
PSQL=(psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres)
cleanup() {
  if [ "$created_db" -eq 1 ]; then
    "${PSQL[@]}" -d postgres -c "drop database ${db_name};" >/dev/null || true
  fi
  rm -rf "$candidate_dir"
}
trap cleanup EXIT
python3 tools/release/build_real_event_candidate.py --candidate --out "$candidate_dir/sql"
"${PSQL[@]}" -d postgres -c "create database ${db_name};"
created_db=1
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
for f in "$candidate_dir"/sql/*.sql; do
  echo "Applying candidate $(basename "$f") to disposable local PostgreSQL only"
  "${PSQL[@]}" -d "$db_name" -f "$f" >/dev/null
done
"${PSQL[@]}" -d "$db_name" -f tests/gameday_real_candidate_disposable.sql
echo "PASS: isolated real-event candidate compiled and checked on local PostgreSQL"
