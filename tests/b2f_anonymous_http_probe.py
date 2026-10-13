#!/usr/bin/env python3
"""B2f: strictly READ-ONLY anonymous HTTP boundary smoke test.

Live execution requires the exact synthetic Supabase project, a modern PUBLIC
publishable key and an organizer-approved synthetic event UUID. No passwords,
JWTs, secret/service-role keys, mutations, or actual participant data.

The negative RPC checks use GET on STABLE, read-only role/matchdesk functions.
An anonymous caller MUST be rejected; no staff or score write RPC is called.
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
APPROVAL = "YES_READ_ONLY_SYNTHETIC_HTTP"
PUBLIC_FIELDS = frozenset({
    "event_id", "event_name", "event_date", "status", "brackets", "updated_at"
})
PUBLIC_COLUMNS = ",".join(sorted(PUBLIC_FIELDS))
ALLOWED_PATHS = frozenset({
    "/rest/v1/fftt_public_results_v1",
    "/rest/v1/fftt_published_events",
    "/rest/v1/fftt_published_matches",
    "/rest/v1/rpc/fftt_staff_role_v1",
    "/rest/v1/rpc/fftt_matchdesk_v1",
    "/rest/v1/event_staff",
})
PRIVATE_FIELDS = frozenset({
    "email", "phone", "contact", "rating", "checked_in",
    "audit", "actor_id", "staff", "password", "token",
})


class SafetyError(RuntimeError):
    pass


@dataclass(frozen=True)
class Response:
    status: int
    body: object


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def config(env: dict[str, str]) -> tuple[str, str]:
    if env.get("FFTT_B2F_APPROVE_READ_ONLY_HOSTED") != APPROVAL:
        raise SafetyError("Explicit read-only hosted approval flag is required")
    url = env.get("FFTT_B2F_URL", HOST).rstrip("/")
    parsed = urllib.parse.urlsplit(url)
    if (
        parsed.scheme != "https" or parsed.hostname != "copmkalfkkrkzheohwuc.supabase.co"
        or parsed.port or parsed.username or parsed.password or parsed.path
        or parsed.query or parsed.fragment or url != HOST
    ):
        raise SafetyError("Only the exact pinned development origin is allowed")
    key = env.get("FFTT_B2F_PUBLISHABLE_KEY", "")
    if not key.startswith("sb_publishable_") or any(x in key for x in "\r\n "):
        raise SafetyError("Only a modern PUBLIC sb_publishable_ key is accepted")
    try:
        event = str(uuid.UUID(env.get("FFTT_B2F_EVENT_ID", "")))
    except (ValueError, TypeError, AttributeError):
        raise SafetyError("A valid synthetic rehearsal event UUID is required") from None
    if event == "00000000-0000-0000-0000-000000000000":
        raise SafetyError("Refusing placeholder event UUID")
    return key, event


def target(path: str, params: dict[str, str] | None = None) -> str:
    if path not in ALLOWED_PATHS:
        raise SafetyError("Refusing request to a non-read-only endpoint")
    query = urllib.parse.urlencode(params or {})
    return HOST + path + ("?" + query if query else "")


def get(key: str, path: str, params: dict[str, str] | None = None,
        *, private_schema: bool = False,
        opener=None) -> Response:
    url = target(path, params)
    headers = {
        "apikey": key,
        "Accept": "application/json",
        "User-Agent": "FFTT-B2f-ReadOnly-Anonymous-Smoke/1",
    }
    if private_schema:
        if path != "/rest/v1/event_staff":
            raise SafetyError("Only private staff projection may use Accept-Profile")
        headers["Accept-Profile"] = "fftt_private"
    request = urllib.request.Request(url, headers=headers, method="GET")
    if opener is None:
        opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=15) as response:
            code, raw = response.status, response.read(128 * 1024)
    except urllib.error.HTTPError as exc:
        code, raw = exc.code, exc.read(128 * 1024)
    except urllib.error.URLError as exc:
        raise SafetyError("Hosted HTTP request failed; no success claim") from exc
    try:
        payload = json.loads(raw) if raw else None
    except (ValueError, UnicodeError):
        raise SafetyError("Hosted API returned non-JSON response") from None
    return Response(code, payload)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SafetyError(message)
    print("PASS:", message, flush=True)


def run_probe(key: str, event_id: str, client=get) -> None:
    """No hosted mutations; the supplied client is mockable for local guard tests."""
    print("B2f anonymous HTTP smoke: GET only, synthetic project, no Auth secrets")
    view = client(key, "/rest/v1/fftt_public_results_v1",
                  {"select": PUBLIC_COLUMNS, "limit": "1"})
    require(view.status == 200 and isinstance(view.body, list)
            and len(view.body) == 0,
            "Anonymous public results allowlisted and unpublished fixture empty")

    for name in ("/rest/v1/fftt_published_events",
                 "/rest/v1/fftt_published_matches"):
        r = client(key, name, {"select": "*", "limit": "1"})
        require(r.status == 200 and r.body == [], name.split("/")[-1] +
                " publicly readable but empty")

    wrong_field = client(key, "/rest/v1/fftt_public_results_v1",
                         {"select": "email", "limit": "1"})
    require(wrong_field.status == 400,
            "Public view rejects private email field projection")

    for name in ("/rest/v1/rpc/fftt_staff_role_v1",
                 "/rest/v1/rpc/fftt_matchdesk_v1"):
        r = client(key, name, {"p_event_id": event_id})
        require(400 <= r.status < 500,
                "Anonymous GET access denied for " + name.split("/")[-1])

    staff = client(key, "/rest/v1/event_staff", {"select": "*", "limit": "1"},
                   private_schema=True)
    require(400 <= staff.status < 500,
            "Private staff schema rejected from public PostgREST endpoint")
    print("B2f PASS: real anonymous API read/deny boundary; NO JWT tests or writes")


def main() -> None:
    try:
        key, event = config(dict(os.environ))
        run_probe(key, event)
    except SafetyError as exc:
        print("B2f anonymous HTTP probe BLOCKED:", str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
