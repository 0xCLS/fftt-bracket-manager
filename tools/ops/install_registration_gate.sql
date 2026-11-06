-- Install (or rotate) the Bracket Manager registration proof secret WITHOUT the value ever appearing in a process
-- argument, a shell history, a psql variable, a SQL statement text or a server statement log.
--
-- The value is read from psql's standard input with \copy (the COPY data stream, not SQL text), so it is supplied by
-- redirecting the private file:
--
--     psql -X -v ON_ERROR_STOP=1 -f tools/ops/install_registration_gate.sql  <  "$GATE_SECRET_FILE"
--
-- Connect with libpq environment/service settings and ~/.pgpass (mode 0600), never with a postgresql://user:password@...
-- URL on the command line (that would put the DATABASE password in the process list). Run it as the database owner
-- AFTER the candidate SQL supabase/proposals/FFTT3_BRACKET_MANAGER_REGISTRATION_20261106_DO_NOT_APPLY.sql.
-- Never run it with the value typed into a -c string, an inline \set, a here-string or an SQL-editor tab.
--
-- The secret file holds exactly one line of 32-200 characters from A-Z a-z 0-9 + / = _ . - (for example
-- `openssl rand -hex 32 | tr -d '\n'`). Anything else (blank line, spaces, a second line, other characters) is refused
-- before anything is stored, so the database copy equals the Cloudflare copy that `wrangler pages secret put`
-- reads from the same file (wrangler trims only trailing whitespace; this script refuses any whitespace).
-- It prints only "installed" and the length, never the value. Re-running with a new file rotates the secret.
\set ON_ERROR_STOP on
begin;
create temporary table gate_input (secret text) on commit drop;
-- CSV mode with delimiter/quote bytes that cannot occur in a valid secret: every line is one field, so a stray tab, quote or
-- backslash in the file reaches the validation below (which never prints the value) instead of a COPY error that would echo the line
\copy gate_input (secret) from pstdin with (format csv, delimiter E'\x1f', quote E'\x1e')
do $check$
declare
  v_rows integer;
  v_secret text;
begin
  if pg_catalog.to_regprocedure('fftt_private.install_registration_gate_v1(text)') is null then
    raise exception 'apply the Bracket Manager registration SQL candidate first (fftt_private.install_registration_gate_v1 is missing)';
  end if;
  select pg_catalog.count(*), pg_catalog.min(secret) into v_rows, v_secret from gate_input;
  if v_rows <> 1 then
    raise exception 'the secret file must contain exactly one line (found % lines)', v_rows;
  end if;
  if v_secret is null or v_secret !~ '^[A-Za-z0-9+/=_.-]{32,200}$' then
    raise exception 'the secret must be 32-200 characters from A-Z a-z 0-9 + / = _ . - with no spaces or other characters';
  end if;
end
$check$;
select fftt_private.install_registration_gate_v1((select secret from gate_input limit 1)) as result,
       (select pg_catalog.char_length(secret) from gate_input limit 1) as characters;
commit;
