#!/usr/bin/env python3
"""Build a strictly source-pinned, OFFLINE real-event SQL candidate.

NEVER deploy automatically. Never changes the synthetic staging SQL or a hosted
database. Every intentional source-to-real transformation is exact-count checked.
A changed upstream SQL blob fails closed until reviewed.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
# Path, expected Git blob SHA-1, list of (old fragment, new fragment, count).
SOURCES = [
    ("supabase/migrations/20261008000100_phase1b_foundation.sql",
     "e8d09249033cd8c5ddd2aa7768ef6932fea39105", [
         ("synthetic_only boolean not null default true check (synthetic_only = true),",
          "synthetic_only boolean not null default false check (synthetic_only = false),", 1)]),
    ("supabase/migrations/20261008000200_restrict_auto_rls_helper.sql",
     "506c86a846457081334be530496abe4bbc301f72", []),
    ("supabase/migrations/20261008000300_b2a_staff_read_api.sql",
     "8b1c07df22f8c03bb82ca26b380fd59ad1e144f2", [
         ("and e.synthetic_only = true;", "and e.synthetic_only = false;", 1)]),
    ("supabase/migrations/20261008000400_b2b_transactional_score.sql",
     "e7d7e230ed5b4b4a2b366bfc65a24acd67ca1d87", [
         ("where id=p_event_id and synthetic_only=true for update;",
          "where id=p_event_id and synthetic_only=false for update;", 1)]),
    ("supabase/migrations/20261009000100_b2d_staff_grants.sql",
     "c731f36792fa67b94d2f0235ce959f0a268d0e1f", [
         ("where id=p_event_id and synthetic_only=true for update;",
          "where id=p_event_id and synthetic_only=false for update;", 1)]),
    ("supabase/proposals/MILESTONE1_DURABLE_SCORING_V2_DO_NOT_APPLY.sql",
     "af46f1d2cf7de1387086a6e2416f358a00e59b1a", [
         ("where id=p_event_id and synthetic_only=true for update;",
          "where id=p_event_id and synthetic_only=false for update;", 1),
         ("where id=p_event_id and synthetic_only=true for share;",
          "where id=p_event_id and synthetic_only=false for share;", 1)]),
    ("supabase/proposals/GAMEDAY_TOURNAMENT_V3_STAGING.sql",
     "ace1d2169aa0b7988c841524e08889b799bd3317", [
         ("where id = p_event_id and synthetic_only = true for update;",
          "where id = p_event_id and synthetic_only = false for update;", 1),
         ("where id = p_event_id and synthetic_only = true;",
          "where id = p_event_id and synthetic_only = false;", 2),
         ("and e.synthetic_only", "and not e.synthetic_only", 1),
         ("'synthetic_only', true,", "'synthetic_only', false,", 1)]),
    ("supabase/proposals/GAMEDAY_TOURNAMENT_V4_STAGING.sql",
     "2506ba1f7477728745133200bdd8d0a818d3f5d7", [
         ("where id=p_event_id and synthetic_only=true for update;",
          "where id=p_event_id and synthetic_only=false for update;", 1),
         ("where id = p_event_id and synthetic_only = true;",
          "where id = p_event_id and synthetic_only = false;", 1),
         ("and e.synthetic_only", "and not e.synthetic_only", 1)]),
    ("supabase/proposals/GAMEDAY_TOURNAMENT_V5_STAGING.sql",
     "14877f8e4334e2a5bdda1a29fea04687d9d3f3da", []),
]

def git_blob_sha(payload: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(payload)).encode() + b"\0" + payload).hexdigest()

def candidate_sql(path: str, sha: str, replacements: list) -> str:
    source = (ROOT / path).read_bytes()
    actual = git_blob_sha(source)
    if actual != sha:
        raise ValueError(f"Source changed: {path}; expected {sha}, got {actual}. Review required.")
    code = source.decode("utf-8")
    for before, after, expected in replacements:
        n = code.count(before)
        if n != expected:
            raise ValueError(f"Unexpected guard count {path}: expected {expected}, got {n} for {before!r}")
        code = code.replace(before, after)
    if re.search(r"\bsynthetic_only\s*=\s*true\b|\band\s+e\.synthetic_only\b", code):
        raise ValueError(f"Unconverted synthetic-only operation in {path}")
    # The real-only CHECK makes it impossible to accidentally insert a synthetic
    # fixture into this DB. V5 continues to reject fixture registration sources.
    return ("-- REAL FFTT EVENT CANDIDATE; OFFLINE VALIDATION ONLY. NOT AUTHORIZED FOR DEPLOYMENT.\n"
            "-- Generated from " + path + " at Git blob " + sha + ". DO NOT APPLY TO SYNTHETIC STAGING.\n"
            + code)

def build(out_dir: Path | None) -> list[tuple[str, str, str]]:
    prepared = []
    for i, (path, sha, changes) in enumerate(SOURCES, start=1):
        name = f"{i:02d}_" + Path(path).name
        body = candidate_sql(path, sha, changes)
        prepared.append((name, body, hashlib.sha256(body.encode()).hexdigest()))
    if out_dir is not None:
        if out_dir.exists() and any(out_dir.iterdir()):
            raise ValueError("Output directory must be empty; refusing to overwrite.")
        out_dir.mkdir(parents=True, exist_ok=True)
        for name, body, _ in prepared:
            (out_dir / name).write_text(body, encoding="utf-8")
    return [(name, digest, str(len(body.encode("utf-8")))) for name, body, digest in prepared]

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--check", action="store_true", help="Check sources and conversions without writing files")
    p.add_argument("--candidate", action="store_true", help="Generate candidate SQL files for local testing only")
    p.add_argument("--out", type=Path, help="Empty output directory for local candidate files")
    args = p.parse_args()
    if args.check == args.candidate or (args.candidate and args.out is None) or (args.check and args.out is not None):
        p.error("Specify exactly --check OR --candidate --out EMPTY_DIRECTORY")
    try:
        files = build(args.out if args.candidate else None)
    except (ValueError, OSError, UnicodeError) as exc:
        print(f"FAIL CLOSED: {exc}", file=sys.stderr)
        return 1
    print("OFFLINE REAL-EVENT CANDIDATE: source/version/transform checks passed; NOT deploy-approved")
    for filename, digest, size in files:
        print(f"  {filename}  sha256={digest}  bytes={size}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
