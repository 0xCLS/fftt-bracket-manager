#!/usr/bin/env python3
"""FFTT B2e: read-only HOSTED Supabase Auth and role-revocation preflight.

This script NEVER creates accounts, inserts fixtures, grants staff, submits
scores, or modifies hosted data. It signs four organizer-controlled TEST-ONLY
accounts in and reads the existing event authorization RPCs.

Operator provides ephemeral environment variables. Never commit passwords,
session tokens, service-role credentials or participant information.
The hard-pinned hostname prevents running against a different project.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass

HOST = "https://copmkalfkkrkzheohwuc.supabase.co"
AUTH_USERS = ("ORGANIZER", "SCOREKEEPER_A", "SCOREKEEPER_B", "OUTSIDER")
PROHIBITED = frozenset({
    "email", "phone", "contact", "rating", "rating_status",
    "checked_in", "first_champ_loss", "staff", "actor_id",
    "submission_id", "audit", "backup",
})


class PreflightError(Exception):
    pass


@dataclass(frozen=True)
class Identity:
    user_id: str
    token: str


@dataclass(frozen=True)
class Response:
    status: int
    data: object


def valid_target(raw: str) -> str:
    parsed = urllib.parse.urlsplit(raw.rstrip("/"))
    if parsed.scheme != "https" or parsed.hostname != "copmkalfkkrkzheohwuc.supabase.co":
        raise PreflightError("Refusing non-approved hosted Supabase project")
    if parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment or parsed.path:
        raise PreflightError("Project URL must be its bare HTTPS origin")
    return HOST


def public_key(raw: str) -> str:
    if raw.startswith("sb_secret_") or raw.startswith("sb_service_"):
        raise PreflightError("Refusing a privileged/secret key in a client smoke test")
    if not raw.startswith("sb_publishable_"):
        raise PreflightError("A project publishable key is required, not legacy JWT or service keys")
    return raw


def config(env: dict[str, str]) -> tuple[str, str, str, dict[str, tuple[str, str]]]:
    origin = valid_target(env.get("FFTT_B2E_URL", HOST))
    key = public_key(env.get("FFTT_B2E_PUBLISHABLE_KEY", ""))
    raw_event = env.get("FFTT_B2E_EVENT_ID", "")
    try:
        event = str(uuid.UUID(raw_event))
    except (ValueError, AttributeError):
        raise PreflightError("Provide the organizer-authorized SYNTHETIC event UUID") from None
    identities: dict[str, tuple[str, str]] = {}
    for role in AUTH_USERS:
        email = env.get(f"FFTT_B2E_{role}_EMAIL", "").strip()
        password = env.get(f"FFTT_B2E_{role}_PASSWORD", "")
        if not email or not password:
            raise PreflightError("Missing a test-only login for " + role)
        if "\n" in email or "@" not in email:
            raise PreflightError("Invalid test-login email format for " + role)
        identities[role] = (email, password)
    if len({e.casefold() for e, _ in identities.values()}) != 4:
        raise PreflightError("Four distinct controlled test accounts are required")
    return origin, key, event, identities


def http(
    origin: str, key: str, method: str, path: str,
    *, token: str | None = None, payload: dict[str, object] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> Response:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"apikey": key, "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)
    request = urllib.request.Request(
        origin + path, data=body, method=method, headers=headers
    )
    try:
        with urllib.request.urlopen(request, timeout=18) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    try:
        parsed = json.loads(raw) if raw else {}
    except (ValueError, UnicodeError):
        parsed = {}
    return Response(status, parsed)


def require(check: bool, message: str) -> None:
    if not check:
        raise PreflightError(message)
    print("PASS:", message, flush=True)


def sign_in(origin: str, key: str, role: str, email: str, password: str) -> Identity:
    result = http(origin, key, "POST", "/auth/v1/token?grant_type=password",
                  payload={"email": email, "password": password})
    if result.status != 200 or not isinstance(result.data, dict):
        raise PreflightError(f"Test-only {role} password login was rejected")
    token = result.data.get("access_token")
    if not isinstance(token, str) or not token:
        raise PreflightError(f"Test-only {role} did not receive an access token")
    check = http(origin, key, "GET", "/auth/v1/user", token=token)
    if check.status != 200 or not isinstance(check.data, dict):
        raise PreflightError(f"{role} signed token could not be verified")
    try:
        user_id = str(uuid.UUID(str(check.data["id"])))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise PreflightError(f"{role} Auth response lacks a valid user ID") from None
    if check.data.get("email_confirmed_at") is None or check.data.get("is_anonymous") is True:
        raise PreflightError(f"{role} must be a confirmed nonanonymous test account")
    print("PASS:", role + " signed in and Auth verified identity", flush=True)
    return Identity(user_id=user_id, token=token)


def denied(response: Response) -> bool:
    return 400 <= response.status < 500


def check_hosted_roles() -> None:
    origin, key, event, credentials = config(dict(os.environ))
    print("B2e hosted read-only verification; no score/staff writes", flush=True)
    signed = {r: sign_in(origin, key, r, *credentials[r]) for r in AUTH_USERS}
    role_path = "/rest/v1/rpc/fftt_staff_role_v1"
    desk_path = "/rest/v1/rpc/fftt_matchdesk_v1"
    expected = {"ORGANIZER": "organizer", "SCOREKEEPER_A": "scorekeeper",
                "SCOREKEEPER_B": "scorekeeper"}

    for r, role in expected.items():
        found = http(origin, key, "POST", role_path,
                     token=signed[r].token, payload={"p_event_id": event})
        require(found.status == 200 and found.data == role,
                r + " current event grant matches expected role")

    for role in ("OUTSIDER",):
        result = http(origin, key, "POST", role_path,
                      token=signed[role].token, payload={"p_event_id": event})
        require(denied(result), "Unassigned authenticated outsider denied")

    require(denied(http(origin, key, "POST", role_path,
                        payload={"p_event_id": event})),
            "Anonymous browser cannot call staff-role RPC")

    for r in ("ORGANIZER", "SCOREKEEPER_A", "SCOREKEEPER_B"):
        desk = http(origin, key, "POST", desk_path, token=signed[r].token,
                    payload={"p_event_id": event})
        require(desk.status == 200 and isinstance(desk.data, list),
                r + " may read minimal event matchdesk")
        for row in desk.data:
            require(isinstance(row, dict) and not (set(row) & PROHIBITED),
                    "Matchdesk excludes private/internal fields")
    require(denied(http(origin, key, "POST", desk_path,
                        token=signed["OUTSIDER"].token,
                        payload={"p_event_id": event})),
            "Outsider denied matchdesk")
    require(denied(http(origin, key, "GET", "/rest/v1/event_staff?select=*",
                        token=signed["SCOREKEEPER_A"].token,
                        extra_headers={"Accept-Profile": "fftt_private"})),
            "Private staff schema not exposed to the REST API")
    print("B2e PASS: hosted signed Auth role/visibility preflight, no writes", flush=True)


if __name__ == "__main__":
    try:
        check_hosted_roles()
    except PreflightError as error:
        print("B2e preflight blocked:", str(error), file=sys.stderr)
        sys.exit(1)
