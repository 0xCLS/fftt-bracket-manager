#!/usr/bin/env python3
"""Read-only, fail-closed Supabase CLI v3 hosted migration preflight.

This checks a frozen, independently reviewed hosted-history snapshot against
the repository. The snapshot is NOT a live query; even a passing audit NEVER
authorizes a hosted db push. Never run migration repair or deployment here.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "supabase" / "hosted_migration_baseline.json"


def blob_sha1(path: Path) -> str:
    content = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(content)).encode("ascii") + b"\0" + content).hexdigest()


def audit() -> int:
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    errors = []
    expected = baseline["tracked_sources"]
    if baseline.get("hosted_push_approved") is not False:
        errors.append("hosted_push_approved must be explicitly false")
    current = {}
    migration_dir = ROOT / "supabase" / "migrations"
    for path in sorted(migration_dir.glob("*.sql")):
        if not re.match(r"^\d{14}_.+\.sql$", path.name):
            errors.append("invalid migration filename: " + path.name)
        current[path.relative_to(ROOT).as_posix()] = blob_sha1(path)

    expected_migrations = {
        path: blob for path, blob in expected.items()
        if path.startswith("supabase/migrations/")
    }
    for path in sorted(set(current) - set(expected_migrations)):
        errors.append("unreviewed migration file: " + path)
    for path in sorted(set(expected_migrations) - set(current)):
        errors.append("missing migration file: " + path)
    for relpath, pinned_blob in sorted(expected.items()):
        path = ROOT / relpath
        if not path.is_file():
            errors.append("missing tracked SQL source: " + relpath)
        elif blob_sha1(path) != pinned_blob:
            errors.append("SQL source changed since read-only audit: " + relpath)

    names = {entry["version"]: entry["name"] for entry in baseline["hosted_migrations"]}
    if len(names) != len(baseline["hosted_migrations"]):
        errors.append("duplicate hosted migration version in snapshot")
    actual_versions = {path.rsplit("/", 1)[-1][:14] for path in current}
    known_hosted = set(names)
    pending = sorted(actual_versions - known_hosted)
    hosted_only = sorted(known_hosted - actual_versions)
    print("Project:", baseline["project"], "(" + baseline["project_ref"] + ")")
    print("Snapshot:", baseline["captured_date"], "(read-only; NOT live)")
    print("Hosted migrations in snapshot:", ", ".join(sorted(known_hosted)))
    print("Local migration versions:", ", ".join(sorted(actual_versions)))
    print("Hosted IDs absent from normal local migration folder:",
          ", ".join(hosted_only) or "none")
    print("Local IDs absent from hosted history:", ", ".join(pending) or "none")
    if baseline.get("version_aliases"):
        print("Verified historical version mappings:")
        for local, hosted in sorted(baseline["version_aliases"].items()):
            print(" ", local, "->", hosted)
    for warning in baseline.get("review_notes", []):
        print("REVIEW:", warning)
    for error in errors:
        print("ERROR:", error)
    print("HOSTED DB PUSH: BLOCKED; this audit has no database credentials or write action.")
    return 1 if errors else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("audit", "gate"), default="audit")
    args = parser.parse_args()
    result = audit()
    if result:
        return result
    if args.mode == "gate":
        print("DENIED: schema/migration deployment requires separate explicit approval,")
        print("a fresh hosted history check, backup/restore proof, and reviewed migration plan.")
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
