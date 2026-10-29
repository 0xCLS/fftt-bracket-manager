#!/usr/bin/env python3
"""B2e guarded organizer-authorized grants for HOSTED synthetic test users.

Unlike b2e_hosted_auth_probe.py this script MUTATES staff grants and event
revision. Never run against real people, real event records or production.
Uses only a publishable browser key and the organizer's genuine signed JWT.
No service-role secret or database password is needed.
"""
from __future__ import annotations

import os
import sys

from b2e_hosted_auth_probe import (
    AUTH_USERS, HOST, PreflightError, config, denied, http, require, sign_in,
)


def run() -> None:
    if os.environ.get("FFTT_B2E_APPROVE_STAFF_GRANTS") != "YES_SYNTHETIC_HOSTED_ONLY":
        raise PreflightError("Set the explicit approval flag for synthetic hosted role grants")
    origin, key, event, identities = config(dict(os.environ))
    require(origin == HOST, "Only preapproved Free synthetic Supabase project accepted")
    signed = {role: sign_in(origin, key, role, *identities[role])
              for role in AUTH_USERS}
    endpoint = "/rest/v1/rpc/fftt_manage_staff_v1"
    role_endpoint = "/rest/v1/rpc/fftt_staff_role_v1"

    organizer = signed["ORGANIZER"]
    organizer_role = http(origin, key, "POST", role_endpoint,
                          token=organizer.token, payload={"p_event_id": event})
    require(organizer_role.status == 200 and organizer_role.data == "organizer",
            "A previously trusted admin bootstrap established the organizer")

    for role in ("SCOREKEEPER_A", "SCOREKEEPER_B"):
        target = signed[role]
        result = http(
            origin, key, "POST", endpoint, token=organizer.token,
            payload={
                "p_event_id": event,
                "p_target_user_id": target.user_id,
                "p_action": "grant",
                "p_role": "scorekeeper",
            })
        require(result.status == 200 and isinstance(result.data, dict)
                and result.data.get("status") in ("granted", "unchanged"),
                "Organizer authorized test-only " + role)
        verified = http(origin, key, "POST", role_endpoint,
                        token=target.token, payload={"p_event_id": event})
        require(verified.status == 200 and verified.data == "scorekeeper",
                role + " role effective with genuine Auth token")

    outsider = signed["OUTSIDER"]
    require(denied(http(origin, key, "POST", role_endpoint,
                        token=outsider.token, payload={"p_event_id": event})),
            "Unassigned outsider remains barred")
    print("B2e hosted test-only staff grants verified; no scoring or player writes")


if __name__ == "__main__":
    try:
        run()
    except PreflightError as error:
        print("B2e staff-grant procedure blocked:", str(error), file=sys.stderr)
        sys.exit(1)
