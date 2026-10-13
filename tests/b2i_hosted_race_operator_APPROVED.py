#!/usr/bin/env python3
"""B2i explicitly approved ONE-MATCH synthetic hosted race, Mac operator only.

Executable only after --execute-approved-one-match AND a typed exact approval.
The exact existing event and match UUIDs are pinned by SHA256 digests without
publishing those private identifiers in the application source. Signed tokens
and keys stay in Mac process memory. Exactly TWO score POSTs, no automatic
replay, no reset, revocation, publishing, or production cutover.
"""
from __future__ import annotations

import concurrent.futures
import getpass
import hashlib
import hmac
import sys
import json
import threading
import urllib.error
import urllib.request
import uuid

import b2h_admin_magiclink_signed_auth as auth
import b2i_hosted_race_oracle as oracle

# Approved by organizer only for two conflicting scores on one synthetic match.
# The CLI flag, exact UUID hashes and local approval phrase ALSO must pass.
HOSTED_SCORE_WRITES_ENABLED = True
EXPECTED_EVENT_DIGEST = "e3a03a5c037688c745116476122fca6c457c00e9925d41522f14930cd4a9f9b8"
EXPECTED_MATCH_DIGEST = "7ef9cfc81a5b6bd7292a286a84085317c36d6b2a8c63014ab1b7ba8a94b419eb"
EXECUTE_FLAG = "--execute-approved-one-match"
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


def validate_pinned_fixture(event_id: str, match_id: str) -> tuple[str, str]:
    event = auth.validate_event(event_id)
    match = auth.validate_event(match_id)
    event_digest = hashlib.sha256(event.encode("ascii")).hexdigest()
    match_digest = hashlib.sha256(match.encode("ascii")).hexdigest()
    oracle.require(hmac.compare_digest(event_digest, EXPECTED_EVENT_DIGEST),
                   "This is NOT the privately approved synthetic event UUID")
    oracle.require(hmac.compare_digest(match_digest, EXPECTED_MATCH_DIGEST),
                   "This is NOT the privately approved pending match UUID")
    return event, match


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
    """Exactly two signed score POSTs, after all safe preflight gates."""
    require_live_approval(approval)
    event, match = validate_pinned_fixture(event_id, match_id)
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
    for outcome in outcomes:
        # Only safe labels and status codes, never response bodies/tokens.
        print("RESULT:", outcome.actor, "HTTP", outcome.http_status,
              "status", outcome.result_status or "(rejected/unreported)", flush=True)
    winner = oracle.verify_race(*outcomes)
    print("B2i HTTP RACE PASS: exactly one accepted, one rejected. Winner:", winner)
    print("POST-RACE SQL NOT YET VERIFIED. STOP. Do not rerun the launcher.")


def main() -> None:
    print("FFTT B2i — one specifically approved synthetic match scoring race")
    print("The two signed score POSTs are IRREVERSIBLE without new approved corrections.")
    print("An accepted result creates an audit record and closes this test match.")
    print("No score retries, no staff changes, no result publication.")
    if len(sys.argv) != 2 or sys.argv[1] != EXECUTE_FLAG:
        print("DRY RUN: no Auth sessions or score requests. Explicit execute flag required.")
        return
    # Obtain both private identifiers and verify source-level hard pins BEFORE
    # accepting an Auth administrator key or generating any sessions.
    organizer = input("Existing synthetic organizer email: ").strip()
    event_input = input("Approved private 2099 synthetic event UUID: ").strip()
    match_input = input("Approved private pending C-0-0 match UUID: ").strip()
    event, match = validate_pinned_fixture(event_input, match_input)
    if not organizer or "@" not in organizer or any(ch.isspace() for ch in organizer):
        raise oracle.RaceNotVerified("An existing organizer email is required")
    print("Only this single synthetic match is authorized. It may finish permanently.")
    phrase = input("Type " + ONE_MATCH_APPROVAL_PHRASE + " to start test: ").strip()
    require_live_approval(phrase)
    secret = auth.check_secret(getpass.getpass(
        "Private Supabase sb_secret_ key (hidden, not saved): "))
    run_approved_one_match(secret, organizer, event, match, phrase)


if __name__ == "__main__":
    try:
        main()
    except (oracle.RaceNotVerified, auth.StopTest) as err:
        print("B2i STOPPED:", str(err), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("B2i UNCERTAIN FAILURE: stop all writes and request independent DB audit.",
              file=sys.stderr)
        sys.exit(1)
