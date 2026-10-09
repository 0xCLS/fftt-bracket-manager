#!/usr/bin/env python3
"""B2h: local-operator ONLY, password-free, hosted signed-Auth rehearsal.

No passwords are recovered or changed; no tournament writes are issued.
Uses a modern sb_secret_ key ONLY in the operator's Terminal for Auth Admin
user-list / generate_link; never stores or displays credentials or JWTs.
Generated one-time links are REDEEMED in memory using public API key to obtain
actual Supabase-issued user access tokens (not fabricated SQL JWT claims).

IMPORTANT: Admin generation/verification creates normal Auth token/session
metadata. It does NOT prove user-controlled inbox possession or normal
volunteer login UX. Read-only event role/matchdesk verification only.
"""
from __future__ import annotations

import getpass
import json
import sys
import urllib.error
import urllib.request
import urllib.parse
import uuid
from dataclasses import dataclass
from typing import Any

HOST = "https://copmkalfkkrkzheohwuc.supabase.co"
PUBLISHABLE_KEY = "sb_publishable_lupD9JDsWFQ_65LuwVL1Fg_O-V5Era0"   # Public client key, never a privileged secret.
EXACT_APPROVAL = "RUN B2H SIGNED AUTH READONLY"
TEST_ONLY = {
    "SCOREKEEPER_A": "fftttesting-scorea@yahoo.com",
    "SCOREKEEPER_B": "fftttesting-scoreb@yahoo.com",
    "OUTSIDER": "fftttesting-outsider@yahoo.com",
}
ROLE_ORDER = ("ORGANIZER", "SCOREKEEPER_A", "SCOREKEEPER_B", "OUTSIDER")
MATCH_FIELDS = frozenset({
    "event_id", "bracket_generation", "match_id", "match_code",
    "match_version", "bracket", "round_number", "slot",
    "player_1_id", "player_2_id", "player_1_name", "player_2_name",
    "is_championship_final", "table_number",
})
ALLOWED = {
    ("GET", "/auth/v1/admin/users"),
    ("POST", "/auth/v1/admin/generate_link"),
    ("POST", "/auth/v1/verify"),
    ("GET", "/auth/v1/user"),
    ("POST", "/rest/v1/rpc/fftt_staff_role_v1"),
    ("POST", "/rest/v1/rpc/fftt_matchdesk_v1"),
    ("GET", "/rest/v1/event_staff"),
    ("GET", "/rest/v1/fftt_public_results_v1"),
}
PRIVATE_FIELDS = {"email", "phone", "rating", "rating_status", "staff", "audit",
                  "checked_in", "actor_id", "submission_id", "contact"}


class StopTest(RuntimeError):
    pass


@dataclass(frozen=True)
class Response:
    code: int
    body: Any


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, url):
        return None


def check_secret(value: str) -> str:
    if not value.startswith("sb_secret_") or any(c.isspace() for c in value):
        raise StopTest("Expected modern private sb_secret_ key, used locally only")
    return value


def validate_event(value: str) -> str:
    try:
        parsed = str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        raise StopTest("Enter a valid synthetic event UUID") from None
    if parsed == str(uuid.UUID(int=0)):
        raise StopTest("Placeholder event UUID refused")
    return parsed


def http(method: str, path: str, key: str, *,
         token: str | None = None, body: dict[str, Any] | None = None,
         params: dict[str, str] | None = None,
         extra: dict[str, str] | None = None) -> Response:
    if (method, path) not in ALLOWED:
        raise StopTest("Request path or method not in strict B2h read/auth allowlist")
    if path.startswith("/auth/v1/admin/") and not key.startswith("sb_secret_"):
        raise StopTest("Admin Auth request requires locally held secret key")
    if not path.startswith("/auth/v1/admin/") and key != PUBLISHABLE_KEY:
        raise StopTest("Non-admin request must use only project public key")
    if token and path.startswith("/auth/v1/admin/"):
        raise StopTest("No user JWT permitted in admin calls")
    if extra and extra != {"Accept-Profile": "fftt_private"}:
        raise StopTest("Unexpected custom HTTP headers")
    if extra and (method, path) != ("GET", "/rest/v1/event_staff"):
        raise StopTest("Private schema header restricted to staff deny test")
    url = HOST + path + ("?" + urllib.parse.urlencode(params) if params else "")
    headers = {"apikey": key, "Accept": "application/json",
               "User-Agent": "FFTT-B2h-Private-Operator-CLI/1"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if extra:
        headers.update(extra)
    payload = None if body is None else json.dumps(body).encode("utf-8")
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=20) as resp:
            status, raw = resp.status, resp.read(131072)
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read(131072)
    except (OSError, urllib.error.URLError):
        raise StopTest("Could not contact the pinned hosted Auth API") from None
    try:
        return Response(status, json.loads(raw) if raw else None)
    except (ValueError, UnicodeError):
        raise StopTest("Auth/API returned non-JSON data; no successful test claim") from None


def require(ok: bool, message: str) -> None:
    if not ok:
        raise StopTest(message)
    print("PASS:", message, flush=True)


def preflight_users(secret: str, organizer_email: str) -> dict[str, str]:
    result = http("GET", "/auth/v1/admin/users", secret,
                  params={"page": "1", "per_page": "100"})
    if result.code != 200 or not isinstance(result.body, dict):
        raise StopTest("Auth Admin user inventory unavailable; check local key and project")
    users = result.body.get("users")
    require(isinstance(users, list) and len(users) == 4,
            "Exact four-account synthetic development preflight")
    expected = {"ORGANIZER": organizer_email.casefold(), **TEST_ONLY}
    if len(set(expected.values())) != 4:
        raise StopTest("Expected four distinct role emails")
    actual: dict[str, str] = {}
    for label in ROLE_ORDER:
        candidates = [u for u in users if isinstance(u, dict)
                      and str(u.get("email") or "").casefold() == expected[label]]
        require(len(candidates) == 1,
                label + " uniquely matches an existing test identity")
        u = candidates[0]
        if not u.get("email_confirmed_at") or u.get("is_anonymous") is True or u.get("deleted_at") or u.get("banned_until"):
            raise StopTest(label + " is not a confirmed, eligible existing Auth identity")
        try:
            actual[label] = str(uuid.UUID(str(u["id"])))
        except (ValueError, TypeError, KeyError, AttributeError):
            raise StopTest(label + " has invalid Auth identity") from None
    require(len(set(actual.values())) == 4,
            "Four independent existing Auth user IDs, no new users created")
    return actual


def exchange_link(secret: str, label: str, email: str, expected_id: str) -> str:
    generated = http("POST", "/auth/v1/admin/generate_link", secret,
                     body={"type": "magiclink", "email": email})
    if generated.code != 200 or not isinstance(generated.body, dict):
        raise StopTest(label + ": admin magic link generation was rejected")
    # Raw GoTrue /auth/v1/admin/generate_link returns a FLAT user object
    # with top-level id, email and hashed_token. supabase-js normalizes it
    # into {"user": {...}, "properties": {...}}. Accept both, but NEVER
    # skip identity validation or redeem when the id/email is missing.
    wrapped = "user" in generated.body or "properties" in generated.body
    if wrapped:
        user = generated.body.get("user")
        props = generated.body.get("properties")
    else:
        user = generated.body
        props = generated.body
    if not isinstance(user, dict) or not isinstance(props, dict):
        raise StopTest(label + ": magic link user or token properties unavailable")
    minted_id = user.get("id")
    minted_email = user.get("email")
    try:
        valid_id = str(uuid.UUID(str(minted_id))) == expected_id
    except (ValueError, TypeError, AttributeError):
        valid_id = False
    if not valid_id or not isinstance(minted_email, str) or minted_email.casefold() != email.casefold():
        raise StopTest(label + ": generated link did not identify existing preflight user")
    token_hash = props.get("hashed_token")
    if not isinstance(token_hash, str) or not token_hash:
        raise StopTest(label + ": missing one-time token hash")
    verified = http("POST", "/auth/v1/verify", PUBLISHABLE_KEY,
                    body={"type": "magiclink", "token_hash": token_hash})
    if verified.code != 200 or not isinstance(verified.body, dict):
        raise StopTest(label + ": one-time magic link could not be redeemed")
    jwt = verified.body.get("access_token")
    if not isinstance(jwt, str) or len(jwt.split(".")) != 3:
        raise StopTest(label + ": no real JWT returned by hosted Auth")
    who = http("GET", "/auth/v1/user", PUBLISHABLE_KEY, token=jwt)
    if who.code != 200 or not isinstance(who.body, dict):
        raise StopTest(label + ": Auth server rejected the signed session")
    require(who.body.get("id") == expected_id and
            str(who.body.get("email") or "").casefold() == email.casefold() and
            who.body.get("email_confirmed_at") is not None and
            who.body.get("is_anonymous") is not True,
            label + " issued JWT resolves to expected existing account")
    return jwt


def check_access(tokens: dict[str, str], event: str) -> None:
    roles = {"ORGANIZER": "organizer",
             "SCOREKEEPER_A": "scorekeeper", "SCOREKEEPER_B": "scorekeeper"}
    for label, role in roles.items():
        response = http("POST", "/rest/v1/rpc/fftt_staff_role_v1", PUBLISHABLE_KEY,
                        token=tokens[label], body={"p_event_id": event})
        require(response.code == 200 and response.body == role,
                label + " signed-JWT event role correct")
        desk = http("POST", "/rest/v1/rpc/fftt_matchdesk_v1", PUBLISHABLE_KEY,
                    token=tokens[label], body={"p_event_id": event})
        if desk.code != 200 or not isinstance(desk.body, list):
            raise StopTest(label + " signed-JWT matchdesk failed")
        require(len(desk.body) == 1 and isinstance(desk.body[0], dict),
                label + " sees exactly one pending synthetic match")
        row = desk.body[0]
        require(set(row).issubset(MATCH_FIELDS) and
                not (set(row) & PRIVATE_FIELDS) and
                row.get("event_id") == event and
                row.get("match_code") == "C-0-0" and
                row.get("match_version") == 0 and
                row.get("bracket_generation") == 1 and
                row.get("player_1_name") == "Synthetic Fixture Alpha" and
                row.get("player_2_name") == "Synthetic Fixture Beta",
                label + " matchdesk exact fixture and private-field restrictions")

    for path in ("/rest/v1/rpc/fftt_staff_role_v1",
                 "/rest/v1/rpc/fftt_matchdesk_v1"):
        response = http("POST", path, PUBLISHABLE_KEY, token=tokens["OUTSIDER"],
                        body={"p_event_id": event})
        require(400 <= response.code < 500,
                "Signed-in outsider denied " + path.rsplit("/", 1)[-1])
    staff = http("GET", "/rest/v1/event_staff", PUBLISHABLE_KEY,
                 token=tokens["SCOREKEEPER_A"],
                 params={"select": "*", "limit": "1"},
                 extra={"Accept-Profile": "fftt_private"})
    require(400 <= staff.code < 500,
            "Actual authenticated HTTP private-schema header access denied")
    anon = http("POST", "/rest/v1/rpc/fftt_staff_role_v1", PUBLISHABLE_KEY,
                body={"p_event_id": event})
    require(400 <= anon.code < 500,
            "Anonymous role RPC denied by hosted gateway")
    public = http("GET", "/rest/v1/fftt_public_results_v1", PUBLISHABLE_KEY,
                  params={"select": "event_id,event_name,event_date,status,brackets,updated_at",
                          "limit": "1"})
    require(public.code == 200 and public.body == [],
            "No synthetic match accidentally published")


def run(secret: str, organizer_email: str, event: str) -> None:
    expected_ids = preflight_users(secret, organizer_email)
    emails = {"ORGANIZER": organizer_email.casefold(), **TEST_ONLY}
    sessions = {}
    for label in ROLE_ORDER:
        sessions[label] = exchange_link(
            secret, label, emails[label], expected_ids[label])
    require(len(sessions) == 4 and len(set(sessions.values())) == 4,
            "Four independent server-issued sessions")
    check_access(sessions, event)
    print("B2h HOSTED PASS: real signed Auth event access verified; "
          "NO score/staff/event writes or password changes", flush=True)
    print("NOTE: admin-initiated sessions do not prove ordinary volunteer login UX")


def main() -> None:
    try:
        print("FFTT B2h — isolated test-only signed Auth, no score writes")
        print("Using this locally WILL generate/redeem four one-time magic links")
        print("and create Auth sessions; it will NOT reset passwords or email links.")
        organizer = input("Existing synthetic ORGANIZER account email: ").strip()
        event = validate_event(input("Private 2099 synthetic event UUID: ").strip())
        if not organizer or "@" not in organizer or "\n" in organizer:
            raise StopTest("Valid existing organizer email required")
        secret = check_secret(getpass.getpass(
            "Private Supabase sb_secret_ key (hidden, never saved): "))
        if input("Type RUN B2H SIGNED AUTH READONLY to authorize Auth sessions: ").strip() != EXACT_APPROVAL:
            raise StopTest("No explicit local approval; no Auth link generated")
        run(secret, organizer, event)
    except StopTest as exc:
        print("B2h STOPPED:", str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
