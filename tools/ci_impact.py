#!/usr/bin/env python3
"""Conservative incremental CI routing. Unknown changes always run the full suite.

PR synchronize events provide *before* and *after* SHAs. Compare the entire
push range, not the cumulative PR diff or just the last commit. This allows
iterating on a long-lived PR without repeatedly rerunning historical gates.
Opening/reopening a PR, pushing to main, or manual dispatch runs full CI.
Release operations must require an explicitly successful full CI run.
"""
import os
import re
import subprocess
import sys

VISUAL = {
    "app/app.css",
    "tests/e2e/gameday_fast_ui_browser.test.mjs",
    "tests/e2e/gameday_polish_browser.test.mjs",
    "tests/e2e/gameday_ui_audit.test.mjs",
    "tests/e2e/gameday_fullnames_layout.test.mjs",
}
INTERACTIVE = {
    "app/view_players.mjs",
    "app/view_registration.mjs",
    "tests/e2e/gameday_registration_browser.test.mjs",
    "tests/e2e/gameday_launch_google_browser.test.mjs",
}
# Changes to these security-sensitive parts of an organizer view are never
# treated as mere UI changes; fail closed to full regression.
DANGEROUS_LINES = re.compile(
    r"core\.actions|checkinRegistrants|setCheckin|addPlayers\(|"
    r"saveRegistrationSource|clearRegistrationSource|"
    r"loadRegistrations|loadRegistrationSettings|inspectSheet|testSheet|"
    r"writable\(|canWrite\(|\.registrationRefs|"
    r"fetch\(|authorization|\btoken\b|secret|signIn\(",
    flags=re.I,
)
SHA = re.compile(r"^[0-9a-fA-F]{40}$")

def git(*args):
    return subprocess.check_output(("git", *args), encoding="utf-8", stderr=subprocess.DEVNULL).strip()

def classify(event, action, before, after):
    if event != "pull_request" or action != "synchronize":
        return "full", "new PR, main push, or explicit full release check"
    if not SHA.fullmatch(before or "") or not SHA.fullmatch(after or ""):
        return "full", "missing before/after GitHub PR sync SHAs"
    try:
        git("cat-file", "-e", before + "^{commit}")
        git("cat-file", "-e", after + "^{commit}")
        changed = [x for x in git("diff", "--name-only", "--diff-filter=ACMRTD", before, after).splitlines() if x]
        if not changed:
            return "full", "empty or unverifiable delta"
        if all(p.startswith("docs/") or p.endswith(".md") for p in changed):
            return "docs", "documentation-only incremental push"
        if any(p not in VISUAL and p not in INTERACTIVE for p in changed):
            return "full", "core, database, security, tooling, or workflow change"
        for path in changed:
            if path not in INTERACTIVE or not path.startswith("app/"):
                continue
            patch = git("diff", "--unified=0", before, after, "--", path)
            edits = "\n".join(x[1:] for x in patch.splitlines()
                              if (x.startswith("+") and not x.startswith("+++"))
                              or (x.startswith("-") and not x.startswith("---")))
            if DANGEROUS_LINES.search(edits):
                return "full", "organizer action, permission, or registration-source logic changed"
        if any(p in INTERACTIVE for p in changed):
            return "ui-interaction", ", ".join(changed)
        return "ui-visual", ", ".join(changed)
    except (OSError, subprocess.CalledProcessError, ValueError):
        return "full", "diff could not be verified"

if __name__ == "__main__":
    lane, reason = classify(
        os.getenv("GITHUB_EVENT_NAME", ""),
        os.getenv("EVENT_ACTION", ""),
        os.getenv("SYNC_BEFORE", ""),
        os.getenv("SYNC_AFTER", ""),
    )
    print("CI lane:", lane)
    print("Reason:", reason)
    output = os.getenv("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as stream:
            stream.write("lane=" + lane + "\n")
    if lane not in ("full", "ui-interaction", "ui-visual", "docs"):
        sys.exit("Unrecognized lane")
