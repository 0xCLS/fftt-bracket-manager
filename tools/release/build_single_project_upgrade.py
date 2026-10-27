#!/usr/bin/env python3
"""Source-pinned, OFFLINE upgrade candidate for ONE existing, populated FFTT Supabase project.

Produces a single SQL transaction: preserve synthetic events, enable new real events
with current event-scoped authorization, make event mode immutable. Never deploys.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys

from build_real_event_candidate import ROOT, SOURCES, git_blob_sha

# Every guard removal remains protected by the original reviewed Git object SHA.
# Uses the last definition of a function (V4 overrides several V3 functions).
REPLACE = {
    "fftt_private.staff_role_for_event": [
        ("and e.synthetic_only = true;", "and e.id = p_event_id;", 1)],
    "fftt_private.submit_match_result_v1": [
        ("where id=p_event_id and synthetic_only=true for update;", "where id=p_event_id for update;", 1)],
    "fftt_private.manage_staff_v1": [
        ("where id=p_event_id and synthetic_only=true for update;", "where id=p_event_id for update;", 1)],
    "fftt_private.submit_match_result_v2": [
        ("where id=p_event_id and synthetic_only=true for update;", "where id=p_event_id for update;", 1)],
    "fftt_private.score_decision_snapshot_v2": [
        ("where id=p_event_id and synthetic_only=true for share;", "where id=p_event_id for share;", 1)],
    "fftt_private.v3_begin": [
        ("where id = p_event_id and synthetic_only = true for update;", "where id = p_event_id for update;", 1)],
    "fftt_private.my_events_v3": [
        ("and e.synthetic_only", "and e.id = s.event_id", 1)],
    "fftt_private.my_events_v4": [
        ("and e.synthetic_only", "and e.id = s.event_id", 1)],
    "fftt_private.organizer_snapshot_v3": [
        ("where id = p_event_id and synthetic_only = true;", "where id = p_event_id;", 1)],
    "fftt_private.event_brief_v3": [
        ("where id = p_event_id and synthetic_only = true;", "where id = p_event_id;", 1)],
    "fftt_private.export_event_v3": [
        ("'synthetic_only', true,", "'synthetic_only', (select e.synthetic_only from fftt_private.events e where e.id = p_event_id),", 1)],
    "fftt_private.create_event_v3": [
        ("insert into fftt_private.events(event_name, event_date, table_count, created_by)\n"
         "  values (v_name, p_date, p_table_count::smallint, v_actor)",
         "insert into fftt_private.events(event_name, event_date, table_count, created_by, synthetic_only)\n"
         "  values (v_name, p_date, p_table_count::smallint, v_actor, false)", 1)],
}

TARGETS = tuple(REPLACE)

def find_definitions(text: str, name: str) -> list[str]:
    definitions = []
    start_re = re.compile(r"(?im)^create(?: or replace)? function\s+" + re.escape(name) + r"\s*\(")
    for match in start_re.finditer(text):
        start = match.start()
        following = text[start:]
        opener = re.search(r"(?i)\bas\s+(\$[A-Za-z_0-9]*\$)", following)
        if not opener:
            raise ValueError(f"Cannot parse SQL function opener: {name}")
        closing = re.search(r"(?m)^" + re.escape(opener.group(1)) + r";[ \t]*$", following[opener.end():])
        if not closing:
            raise ValueError(f"Cannot parse SQL function terminator: {name}")
        end = start + opener.end() + closing.end()
        definitions.append(text[start:end])
    return definitions

def load_latest():
    """Verify every pinned source blob, then return ({function: (path, last definition)}, [(path, code)])."""
    latest = {}
    files = []
    for path, sha, _ in SOURCES:
        payload = (ROOT / path).read_bytes()
        if git_blob_sha(payload) != sha:
            raise ValueError(f"Source drift; review {path} before any build")
        code = payload.decode("utf-8")
        files.append((path, code))
        for name in TARGETS:
            defs = find_definitions(code, name)
            if defs:
                latest[name] = (path, defs[-1])
    if set(latest) != set(TARGETS):
        raise ValueError(f"Missing pinned routines: {sorted(set(TARGETS)-set(latest))}")
    return latest, files

def generate() -> str:
    latest, files = load_latest()

    # If a new synthetic-only predicate appears in any routine in a pinned
    # source file, fail closed rather than silently leave an inaccessible RPC.
    guard_hints = []
    for path, code in files:
        if path.endswith("phase1b_foundation.sql"):
            continue
        for no, line in enumerate(code.splitlines(), 1):
            if "synthetic_only" in line and not line.lstrip().startswith("--"):
                if "GAMEDAY_TOURNAMENT_V5" in path:
                    continue  # V5 must keep conditional fixture/Google restrictions
                if "synthetic_only" in line and (" = true" in line or "=true" in line or "and e.synthetic_only" in line or "'synthetic_only', true" in line):
                    guard_hints.append((path, no, line.strip()))
    if len(guard_hints) != 13:
        raise ValueError(f"Unexpected synthetic-only guards ({len(guard_hints)}); manual security review needed: {guard_hints}")

    routines = []
    for name in TARGETS:
        path, definition = latest[name]
        for old, new, count in REPLACE[name]:
            if definition.count(old) != count:
                raise ValueError(f"Expected {count} guards in {name}; saw {definition.count(old)}: {old!r}")
            definition = definition.replace(old, new)
        if re.search(r"synthetic_only\s*=\s*true\b|and e\.synthetic_only\b", definition):
            raise ValueError(f"Unconverted synthetic-only guard in {name}")
        # Preserve function signature, SECURITY DEFINER search_path, API grants,
        # input parameter semantics and all Auth checks.
        definition = re.sub(r"(?i)^create(?: or replace)? function\s+", "create or replace function ", definition, count=1)
        routines.append(f"-- Reuse live signature from pinned {path}\n" + definition)

    header = """-- FFTT EXISTING-PROJECT LAUNCH UPGRADE CANDIDATE — DO NOT DEPLOY WITHOUT APPROVAL
-- OFFLINE review and populated-disposable-DB tests ONLY. Not an automatic migration.
-- Preserve existing synthetic rows and grant/event history, never delete fixture data.
begin;
do $mode_preflight$
begin
  if not exists (select 1 from pg_constraint
       where conrelid='fftt_private.events'::regclass
         and conname='events_synthetic_only_check') then
    raise exception 'FFTT migration preflight: expected synthetic CHECK not present';
  end if;
  if exists (select 1 from fftt_private.events where synthetic_only is distinct from true) then
    raise exception 'FFTT migration preflight: unexpected non-synthetic data already exists';
  end if;
end
$mode_preflight$;

alter table fftt_private.events drop constraint events_synthetic_only_check;

-- No valid application RPC can retroactively turn a synthetic rehearsal into real data.
create function fftt_private.prevent_event_mode_change()
returns trigger language plpgsql set search_path = ''
as $guard$
begin
  if new.synthetic_only is distinct from old.synthetic_only then
    raise exception 'fftt_event_mode_immutable' using errcode='23514';
  end if;
  return new;
end
$guard$;
revoke all on function fftt_private.prevent_event_mode_change() from public, anon, authenticated;
create trigger fftt_events_event_mode_immutable
before update of synthetic_only on fftt_private.events
for each row execute function fftt_private.prevent_event_mode_change();

"""
    footer = """
-- Keep existing private-schema protections. No new public API wrappers or roles.
-- Existing public wrappers call the replaced internal routines and retain grants.
commit;
"""
    return header + "\n\n".join(routines) + "\n" + footer

def generate_rollback() -> str:
    """Inverse of generate(): the pinned ORIGINAL routines, the synthetic CHECK and no mode trigger.

    Refuses (and changes nothing) once any real event exists: a real event cannot satisfy the synthetic
    CHECK, and deleting real data is never done implicitly. In that case restore from the private backup
    or archive the real event first.
    """
    latest, _ = load_latest()
    routines = []
    for name in TARGETS:
        path, definition = latest[name]
        definition = re.sub(r"(?i)^create(?: or replace)? function\s+", "create or replace function ", definition, count=1)
        routines.append(f"-- Restore original pinned routine from {path}\n" + definition)
    header = """-- FFTT EXISTING-PROJECT LAUNCH UPGRADE ROLLBACK — DO NOT RUN WITHOUT APPROVAL
-- Restores the pre-upgrade (synthetic-only) schema state. Refuses if a real event exists.
begin;
do $rollback_preflight$
begin
  if exists (select 1 from fftt_private.events where synthetic_only is distinct from true) then
    raise exception 'FFTT rollback refused: a real (non-synthetic) event exists; back it up and archive it first';
  end if;
  if exists (select 1 from pg_constraint where conrelid='fftt_private.events'::regclass and conname='events_synthetic_only_check') then
    raise exception 'FFTT rollback preflight: synthetic CHECK already present (upgrade not applied?)';
  end if;
end
$rollback_preflight$;

drop trigger fftt_events_event_mode_immutable on fftt_private.events;
drop function fftt_private.prevent_event_mode_change();
alter table fftt_private.events add constraint events_synthetic_only_check check (synthetic_only = true);

"""
    return header + "\n\n".join(routines) + "\nnotify pgrst, 'reload schema';\ncommit;\n"

def main() -> int:
    arg = argparse.ArgumentParser(description=__doc__)
    group = arg.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--out", type=Path, help="NEW nonexistent file to create (offline SQL only)")
    group.add_argument("--rollback-out", type=Path, help="NEW nonexistent file for the matching ROLLBACK SQL (offline only)")
    opt = arg.parse_args()
    try:
        if opt.rollback_out:
            sql = generate_rollback()
            if opt.rollback_out.exists():
                raise ValueError("Refusing to overwrite an existing rollback SQL file")
            opt.rollback_out.parent.mkdir(parents=True, exist_ok=True)
            opt.rollback_out.write_text(sql, encoding="utf-8", newline="\n")
            print(f"PASS: rollback candidate; {len(TARGETS)} functions; {len(sql)} bytes; NOT RUN")
            return 0
        sql = generate()
        if opt.out:
            if opt.out.exists():
                raise ValueError("Refusing to overwrite an existing candidate SQL file")
            opt.out.parent.mkdir(parents=True, exist_ok=True)
            opt.out.write_text(sql, encoding="utf-8", newline="\n")
        print(f"PASS: source-pinned, single-project in-place candidate; {len(TARGETS)} functions; {len(sql)} bytes; NOT DEPLOYED")
        return 0
    except (ValueError, OSError, UnicodeError) as exc:
        print(f"FAIL CLOSED: {exc}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
