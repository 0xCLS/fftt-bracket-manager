#!/usr/bin/env bash
# The proof-secret installer (tools/ops/install_registration_gate.sql) on a THROWAWAY local PostgreSQL started here with
# log_statement = 'all': the secret must reach the database through psql's stdin only, so it must appear in no process
# argument and no server log, a bad file must be refused before anything is stored, and the stored value must equal the
# file. Fictional values; no hosted service; the cluster, socket and files are removed on exit.
# PostgreSQL server binaries are located automatically; set REQUIRE_PG_BINARIES=1 to fail (not skip) when none exist.
set -euo pipefail
cd "$(dirname "$0")/.."
bin=""
for d in ${PG_BIN:-}  "$(dirname "$(command -v initdb 2>/dev/null || echo /nonexistent/x)")" /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin; do
  if [ -x "$d/initdb" ] && [ -x "$d/pg_ctl" ]; then bin="$d"; break; fi
done
if [ -z "$bin" ]; then
  [ "${REQUIRE_PG_BINARIES:-0}" = "1" ] && { echo "FAIL: no PostgreSQL server binaries found"; exit 1; }
  echo "SKIP: no PostgreSQL server binaries found"; exit 0
fi
tmp="$(mktemp -d /tmp/fftt-gate.XXXXXX)"
sock="$tmp/s"; mkdir -p "$sock"
cleanup() { "$bin/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
echo "PostgreSQL: $("$bin/postgres" --version)"
"$bin/initdb" -D "$tmp/data" -A trust -U postgres >/dev/null
"$bin/pg_ctl" -D "$tmp/data" -l "$tmp/server.log" -w -o "-c listen_addresses='' -c unix_socket_directories=$sock -c log_statement=all -c log_min_duration_statement=0 -c log_parameter_max_length=-1 -c log_connections=on" start >/dev/null
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$sock" -U postgres -d postgres)

# the real table and installer, cut from the reviewed candidate (the test fails if the markers move)
awk '/^create table fftt_private.registration_gate/{p=1} p{print} /^\$f\$;/&&p&&++n==1{exit}' \
  supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql > "$tmp/installer_objects.sql"
grep -q 'install_registration_gate_v1' "$tmp/installer_objects.sql" || { echo "FAIL: installer not found in the candidate"; exit 1; }
{ echo 'create role anon; create role authenticated; create schema fftt_private;'; cat "$tmp/installer_objects.sql"; } | "${PSQL[@]}" >/dev/null
INSTALL=(-f tools/ops/install_registration_gate.sql)

secret_a="$(openssl rand -hex 32 | tr -d '\n')"
printf '%s' "$secret_a" > "$tmp/a.txt"
# 2. a good file installs, the stored value equals the file, the output has the length but not the value
out="$("${PSQL[@]}" "${INSTALL[@]}" < "$tmp/a.txt" 2>&1)"
echo "$out" | grep -q installed || { echo "FAIL: not installed: $out"; exit 1; }
echo "$out" | grep -q "$secret_a" && { echo "FAIL: installer printed the secret"; exit 1; }
stored="$("${PSQL[@]}" -At -c "select convert_from(secret,'UTF8') from fftt_private.registration_gate")"
[ "$stored" = "$secret_a" ] || { echo "FAIL: stored value differs from the file"; exit 1; }
# a trailing newline in the file (editors, echo) installs the same value that wrangler (which trims trailing whitespace) reads
printf '%s\n' "$secret_a" > "$tmp/a_nl.txt"
"${PSQL[@]}" "${INSTALL[@]}" < "$tmp/a_nl.txt" >/dev/null
[ "$("${PSQL[@]}" -At -c "select convert_from(secret,'UTF8') from fftt_private.registration_gate")" = "$secret_a" ] || { echo "FAIL: trailing newline changed the value"; exit 1; }

# a Windows line ending is stripped by COPY the same way wrangler trims it: still the same value, never a stored CR
printf '%s\r\n' "$secret_a" > "$tmp/a_crlf.txt"
"${PSQL[@]}" "${INSTALL[@]}" < "$tmp/a_crlf.txt" >/dev/null
[ "$("${PSQL[@]}" -At -c "select convert_from(secret,'UTF8') from fftt_private.registration_gate")" = "$secret_a" ] || { echo "FAIL: CRLF changed the value"; exit 1; }

# 3. rotation replaces the single row
secret_b="$(openssl rand -base64 48 | tr -d '\n')"
printf '%s' "$secret_b" > "$tmp/b.txt"
"${PSQL[@]}" "${INSTALL[@]}" < "$tmp/b.txt" >/dev/null
[ "$("${PSQL[@]}" -At -c "select (select count(*) from fftt_private.registration_gate)||':'||convert_from(secret,'UTF8') from fftt_private.registration_gate")" = "1:$secret_b" ] || { echo "FAIL: rotation"; exit 1; }

# 4. the secret is in no server log (statements, durations, bind parameters) and the installer script itself has none
for s in "$secret_a" "$secret_b"; do
  grep -qF "$s" "$tmp/server.log" && { echo "FAIL: a secret reached the server log"; exit 1; }
done
grep -q 'registration_gate_v1' "$tmp/server.log" || { echo "FAIL: the statement log was not capturing the installer"; exit 1; }
grep -qE 'gate_secret|:'"'"'' tools/ops/install_registration_gate.sql && { echo "FAIL: installer interpolates a variable"; exit 1; }

# 5. bad files are refused, and the stored value stays b
bad() {
  printf '%b' "$2" > "$tmp/bad.txt"
  if "${PSQL[@]}" "${INSTALL[@]}" < "$tmp/bad.txt" >"$tmp/bad.out" 2>&1; then echo "FAIL: accepted $1"; exit 1; fi
  [ "$("${PSQL[@]}" -At -c "select convert_from(secret,'UTF8') from fftt_private.registration_gate")" = "$secret_b" ] || { echo "FAIL: $1 changed the stored value"; exit 1; }
  grep -qF "$(printf '%b' "$2" | head -c 20)" "$tmp/bad.out" && [ ${#2} -gt 8 ] && { echo "FAIL: $1 error echoed the value"; exit 1; }
  return 0
}
bad "empty file" ''
bad "short secret" 'tooshortsecret'
bad "two lines" "$secret_a\n$secret_a\n"
bad "blank second line" "$secret_a\n\n"
bad "space inside" "${secret_a:0:20} ${secret_a:21}"
bad "trailing space" "$secret_a "
bad "tab" "${secret_a:0:20}\t${secret_a:21}"
bad "double quote" "${secret_a:0:20}\"${secret_a:21}"
bad "mid-line carriage return" "${secret_a:0:20}\r${secret_a:21}"
bad "invalid UTF-8" "${secret_a:0:20}\xff${secret_a:22}"
bad "backslash" "${secret_a:0:20}\\\\${secret_a:22}"
bad "non-ASCII" "${secret_a:0:20}é${secret_a:22}"
bad "201 characters" "$(printf 'a%.0s' $(seq 1 201))"

# bad files (valid or not) never reached the server log either
grep -qF "${secret_a:0:20}" "$tmp/server.log" && { echo "FAIL: part of a refused file reached the server log"; exit 1; }

# 6. no installed function: clear refusal
"${PSQL[@]}" -c 'drop function fftt_private.install_registration_gate_v1(text)' >/dev/null
if "${PSQL[@]}" "${INSTALL[@]}" < "$tmp/a.txt" >"$tmp/m.out" 2>&1; then echo "FAIL: ran without the candidate"; exit 1; fi
grep -q 'apply the Bracket Manager registration SQL candidate first' "$tmp/m.out" || { echo "FAIL: unclear message"; cat "$tmp/m.out"; exit 1; }
echo "PASS: proof-secret installer reads stdin only, validates, rotates, and never reaches a log or output"
