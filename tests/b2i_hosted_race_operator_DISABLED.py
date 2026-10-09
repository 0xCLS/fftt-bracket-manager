#!/usr/bin/env python3
"""B2i hosted race OPERATOR TEMPLATE — hard disabled, not for live execution.

DO NOT enable score writes unless organizer explicitly approves a separate
one-match synthetic-only scoring change and the event passes fresh SQL preflight.
Creates no sessions, credentials, or HTTP requests while the hard gate is off.
B2h remains a read-only probe; B2c remains localhost-only.
"""
from __future__ import annotations

import concurrent.futures
import json
import threading
import urllib.error
import urllib.request
import uuid

import b2h_admin_magiclink_signed_auth as auth
import b2i_hosted_race_oracle as oracle

# CRITICAL: Deliberately disabled. Enable only in a reviewed post-approval
# commit; never do so merely because somebody ran this file on their Mac.
HOSTED_SCORE_WRITES_ENABLED = False
ONE_MATCH_APPROVAL_PHRASE = "AUTHORIZE EXACT B2I SYNTHETIC SCORE RACE"
SCORE_PATH = "/rest/v1/rpc/fftt_submit_match_result_v1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def require_live_approval(phrase: str) -> None:
    if HOSTED_SCORE_WRITES_ENABLED is not True:
        raise oracle.RaceNotVerified(
            "B2i hosted write gate is DISABLED in source; no score request permitted")
    if phrase != ONE_MATCH_APPROVAL_PHRASE:
        raise oracle.RaceNotVerified("Separate, explicit B2i synthetic scoring approval required")


def verify_matchdesk_row(row: dict, event_id: str, match_id: str) -> None:
    expected = {
        "event_id": event_id,
        "match_id": match_id,
        "match_code": "C-0-0",
        "match_version": 0,
        "bracket_generation": 1,
        "player_1_name": "Synthetic Fixture Alpha",
        "player_2_name": "Synthetic Fixture Beta",
    }
    oracle.require(isinstance(row, dict), "Hosted desk row unavailable")
    for field, value in expected.items():
        oracle.require(row.get(field) == value, "Fixture matchdesk differs: " + field)
    for side in ("player_1_id", "player_2_id"):
        try:
            uuid.UUID(str(row[side]))
        except (ValueError, TypeError, KeyError, AttributeError):
            raise oracle.RaceNotVerified("Missing valid synthetic player UUID") from None
    oracle.require(row["player_1_id"] != row["player_2_id"],
                   "One player UUID cannot occupy both match slots")


def score_payloads(row: dict, event_id: str, match_id: str) -> dict[str, dict]:
    """Build two contradictory valid scores without side effects."""
    verify_matchdesk_row(row, event_id, match_id)
    common = {
        "p_event_id": event_id, "p_match_id": match_id,
        "p_bracket_generation": 1, "p_expected_match_version": 0,
        "p_table_number": 1,
    }
    return {
        "SCOREKEEPER_A": {
            **common, "p_winner_id": row["player_1_id"],
            "p_game_scores": "11-7, 11-8", "p_submission_id": str(uuid.uuid4())},
        "SCOREKEEPER_B": {
            **common, "p_winner_id": row["player_2_id"],
            "p_game_scores": "8-11, 7-11", "p_submission_id": str(uuid.uuid4())},
    }


def submit_once(jwt: str, payload: dict, approval: str, barrier: threading.Barrier
                ) -> tuple[int, str | None]:
    """One HTTP POST, only after BOTH independent static and local approval gates."""
    require_live_approval(approval)
    if not jwt or jwt.count(".") != 2:
        raise oracle.RaceNotVerified("A genuine signer JWT is required")
    data = json.dumps(payload).encode("utf-8")
    headers = {
        "apikey": auth.PUBLISHABLE_KEY, "Accept": "application/json",
        "Authorization": "Bearer " + jwt, "Content-Type": "application/json",
        "User-Agent": "FFTT-B2i-Explicit-One-Match-Race/1",
    }
    req = urllib.request.Request(auth.HOST + SCORE_PATH, data=data,
                                 headers=headers, method="POST")
    barrier.wait(timeout=15)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=20) as response:
            status, raw = response.status, response.read(4096)
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read(4096)
    # Any network error/timeout deliberately propagates: no automatic replay.
    try:
        body = json.loads(raw) if raw else None
    except (ValueError, UnicodeError):
        raise oracle.RaceNotVerified("Score response unparseable; STOP ALL WRITES")
    value = body.get("status") if isinstance(body, dict) else None
    return status, value


def run_approved_one_match(secret: str, organizer_email: str, event_id: str,
                           match_id: str, approval: str) -> None:
    """Not reachable while source's disabled flag stays False."""
    require_live_approval(approval)
    event = auth.validate_event(event_id)
    match = auth.validate_event(match_id)
    users = auth.preflight_users(secret, organizer_email)
    emails = {"ORGANIZER": organizer_email.casefold(), **auth.TEST_ONLY}
    tokens = {label: auth.exchange_link(secret, label, emails[label], users[label])
              for label in auth.ROLE_ORDER}
    auth.check_access(tokens, event)  # B2h read-only JWT, outsider, privacy tests
    desk = auth.http("POST", "/rest/v1/rpc/fftt_matchdesk_v1",
                     auth.PUBLISHABLE_KEY, token=tokens["SCOREKEEPER_A"],
                     body={"p_event_id": event})
    oracle.require(desk.code == 200 and isinstance(desk.body, list)
                   and len(desk.body) == 1, "Exactly one authorized pending match required")
    row = desk.body[0]
    payloads = score_payloads(row, event, match)
    print("Explicit one-match synthetic-only HTTP race commencing. NO retries.")
    barrier = threading.Barrier(2)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs = {label: pool.submit(submit_once, tokens[label], payloads[label],
                                   approval, barrier)
                for label in ("SCOREKEEPER_A", "SCOREKEEPER_B")}
        try:
            outcomes = [
                oracle.SubmissionOutcome(label, *jobs[label].result(timeout=30))
                for label in ("SCOREKEEPER_A", "SCOREKEEPER_B")]
        except Exception:
            print("UNCERTAIN HTTP outcome. STOP ALL WRITES. Independent DB audit required.")
            raise
    winner = oracle.verify_race(*outcomes)
    print("Responses show one signed accepted submission from", winner)
    print("PERSISTENCE NOT YET VERIFIED. Stop; independent hosted SQL audit required.")


def main() -> None:
    print("FFTT B2i hosted race operator template (DRAFT — NO EXECUTION)")
    require_live_approval("")
    raise RuntimeError("This source intentionally cannot write hosted scores")


if __name__ == "__main__":
    try:
        main()
    except oracle.RaceNotVerified as err:
        print("SAFE STOP:", str(err))
