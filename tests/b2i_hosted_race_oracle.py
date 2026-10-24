#!/usr/bin/env python3
"""B2i pure, offline hosted race acceptance checks: NO network, no writes.

This module consumes only synthetic, non-secret observations supplied later
by an independently approved operator run. Never fetch JWTs, passwords or
secret API keys; never submit results or reset any database fixture.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


class RaceNotVerified(ValueError):
    pass


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise RaceNotVerified(reason)


EVENT_NAME = "B2e Synthetic Hosted Rehearsal — NOT FFTT3"
DATE = "2099-01-01"
ACTORS = frozenset(("SCOREKEEPER_A", "SCOREKEEPER_B"))


@dataclass(frozen=True)
class SubmissionOutcome:
    actor: str
    http_status: int
    result_status: str | None


def verify_before(snapshot: Mapping[str, Any]) -> None:
    """Require the exact existing synthetic fixture before any scoring."""
    expected = {
        "synthetic_only": True, "event_name": EVENT_NAME, "event_date": DATE,
        "lifecycle": "active", "event_count": 1, "event_revision": 3,
        "bracket_generation": 1, "auth_user_count": 4, "organizer_count": 1,
        "scorekeeper_count": 2, "outsider_grant_count": 0,
        "players": 2, "brackets": 1, "pending_matches": 1,
        "completed_matches": 0, "match_code": "C-0-0",
        "match_version": 0, "score_receipts": 0, "result_audits": 0,
        "audit_count": 3, "published_events": 0, "published_matches": 0,
        "player_one": "Synthetic Fixture Alpha",
        "player_two": "Synthetic Fixture Beta",
        "winner_is_null": True, "scores_are_empty": True,
        "event_id_confirmed_privately": True,
        "match_id_confirmed_privately": True,
    }
    require(set(expected).issubset(snapshot), "Missing required independent preflight evidence")
    for name, value in expected.items():
        require(type(snapshot[name]) is type(value) and snapshot[name] == value,
                "Mismatch in protected preflight field: " + name)


def verify_race(first: SubmissionOutcome, second: SubmissionOutcome) -> str:
    """The service, not this validator, decides which actor wins the race."""
    outcomes = (first, second)
    require({s.actor for s in outcomes} == ACTORS,
            "Two independently authenticated scorekeepers required")
    for s in outcomes:
        require(type(s.http_status) is int and 100 <= s.http_status <= 599,
                "Invalid HTTP status; cannot claim PASS")
    accepted = [s for s in outcomes if s.http_status == 200
                and s.result_status == "accepted"]
    rejected = [s for s in outcomes if 400 <= s.http_status < 500]
    require(len(accepted) == 1 and len(rejected) == 1,
            "Not exactly one accepted score and one 4xx rejected score")
    return accepted[0].actor


def verify_after(snapshot: Mapping[str, Any], winner_actor: str) -> None:
    """Independent persisted PostgreSQL evidence required after response checks."""
    require(winner_actor in ACTORS, "Unknown winning scorekeeper")
    expected = {
        "synthetic_only": True, "event_count": 1, "event_revision": 4,
        "bracket_generation": 1, "match_code": "C-0-0",
        "match_status": "complete", "match_version": 1,
        "completed_matches": 1, "score_receipts": 1, "result_audits": 1,
        "audit_count": 4, "consolation_candidates": 1,
        "organizer_count": 1, "scorekeeper_count": 2,
        "outsider_grant_count": 0, "published_events": 0,
        "published_matches": 0, "event_id_confirmed_privately": True,
        "match_id_confirmed_privately": True,
    }
    require(set(expected).issubset(snapshot), "Missing post-race SQL evidence")
    for name, value in expected.items():
        require(type(snapshot[name]) is type(value) and snapshot[name] == value,
                "Persisted race invariant failed: " + name)
    require(snapshot.get("winning_actor") == winner_actor,
            "Stored result receipt does not match accepted signed user")
    require(snapshot.get("winner_player") in
            ("Synthetic Fixture Alpha", "Synthetic Fixture Beta"),
            "Stored winner not an expected fictional participant")
    require(snapshot.get("accepted_winner_player") == snapshot.get("winner_player"),
            "Stored winner disagrees with accepted response")


def safe_recovery_rule() -> str:
    return (
        "On timeout, 5xx or unclear result, STOP ALL WRITES. Read the exact "
        "stored event, match, receipts and audits before any retry. Do not "
        "automatically replay scores, reset the fixture, change privileges "
        "or delete audit records. Ask organizer approval for corrective writes."
    )


if __name__ == "__main__":
    print("B2i offline validator only. No hosted score submissions.")
    print(safe_recovery_rule())
