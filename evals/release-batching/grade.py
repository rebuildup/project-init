#!/usr/bin/env python3
"""Structural preflight for advisory release batching decisions.

This verifies invariants; it does not decide when release value outweighs cost,
verify that input claims are true, or authorize any external side effect.
"""
import json
import sys
from pathlib import Path

BASIS_FIELDS = ("scope", "value", "waiting", "change_risk", "release_cost")
TRIGGERS = {"weekly", "change_limit", "value", "wait_limit", "urgent", "manual"}
OUTCOMES = {"hold", "candidate", "blocked"}
STAGES = {"collecting", "frozen", "verified"}


def check(data):
    failures = []
    if not isinstance(data, dict):
        return ["decision must be a JSON object"]

    def field(name):
        if name not in data:
            failures.append("missing field: " + name)
        return data.get(name)

    trigger = field("trigger")
    outcome = field("outcome")
    stage = field("stage")
    basis = field("basis")
    admitted = field("admission_passed")
    candidate_sha = field("candidate_sha")
    validated_sha = field("validated_sha")
    gate_passed = field("release_gate_passed")
    ticket_landing = field("ticket_landing_requested")
    release_merge = field("release_merge_requested")
    authorized = field("release_authorized")
    authorized_sha = field("authorized_sha")

    if trigger not in TRIGGERS:
        failures.append("invalid release review trigger")
    if outcome not in OUTCOMES:
        failures.append("invalid review outcome")
    if stage not in STAGES:
        failures.append("invalid candidate stage")

    if not isinstance(basis, dict):
        failures.append("basis must contain scope/value/waiting/change_risk/release_cost")
    else:
        for name in BASIS_FIELDS:
            if not isinstance(basis.get(name), str) or not basis[name].strip():
                failures.append("missing basis: " + name)

    for name, value in (
        ("admission_passed", admitted),
        ("release_gate_passed", gate_passed),
        ("ticket_landing_requested", ticket_landing),
        ("release_merge_requested", release_merge),
        ("release_authorized", authorized),
    ):
        if type(value) is not bool:
            failures.append(name + " must be a boolean")

    if outcome == "hold" and stage != "collecting":
        failures.append("hold cannot freeze/verify a candidate")
    if outcome == "candidate":
        if admitted is not True:
            failures.append("candidate requires admitted scope")
        if isinstance(basis, dict) and basis.get("scope", "").strip().lower() == "unknown":
            failures.append("candidate scope cannot be unknown")
        if stage not in ("frozen", "verified"):
            failures.append("candidate needs a frozen or verified stage")

    if stage in ("frozen", "verified"):
        if not isinstance(candidate_sha, str) or not candidate_sha.strip():
            failures.append("freeze requires an immutable candidate SHA")
        if ticket_landing is True:
            failures.append("candidate freeze forbids unrelated ticket landing")

    if stage == "verified":
        if gate_passed is not True or validated_sha != candidate_sha:
            failures.append("verified requires a passed gate for current candidate SHA")

    if release_merge is True:
        if outcome != "candidate" or stage != "verified":
            failures.append("release merge requires a verified candidate")
        if authorized is not True or authorized_sha != candidate_sha:
            failures.append("release merge requires explicit authorization for current candidate SHA")

    return failures


def main():
    if len(sys.argv) != 2:
        print("usage: grade.py decision.json", file=sys.stderr)
        return 2
    try:
        decision = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("INVALID " + str(exc))
        print("EVAL FAIL")
        return 1
    failures = check(decision)
    for failure in failures:
        print("VIOL " + failure)
    print("EVAL FAIL" if failures else "EVAL PASS")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
