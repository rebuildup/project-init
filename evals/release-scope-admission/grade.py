#!/usr/bin/env python3
"""A deterministic release admission gate, independent of terminal validation."""
import json
import sys
from pathlib import Path


def fail(reason):
    print(f"FAIL {reason}")
    raise SystemExit(1)


def filled(v):
    return isinstance(v, str) and bool(v.strip())


def grade(filename):
    try:
        scope = json.loads(Path(filename).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        fail(f"invalid release scope JSON: {exc}")
    if not isinstance(scope, dict) or not filled(scope.get("release")):
        fail("release scope metadata missing")
    tickets = scope.get("tickets")
    if not isinstance(tickets, list) or not tickets:
        fail("at least one ticket required")
    stable = scope.get("work_graph_stable")
    terminal = scope.get("terminal_validated")
    ready = scope.get("release_ready")
    if any(type(x) is not bool for x in (stable, terminal, ready)):
        fail("work graph / terminal validation / release readiness must be explicit booleans")
    if ready and not terminal:
        fail("release-ready requires a separate successful terminal gate")
    for ticket in tickets:
        if not isinstance(ticket, dict) or not filled(ticket.get("id")):
            fail("ticket must have an identity")
        name = ticket["id"]
        status = ticket.get("admission")
        critical = ticket.get("critical_path")
        if status not in ("admitted", "discovery", "backlog") or type(critical) is not bool:
            fail(f"{name}: admission and critical path must be explicit")
        reasons = []
        if not stable:
            reasons.append("Structural unknown: Work Graph unstable")
        if ticket.get("requirements") != "decidable":
            reasons.append("requirements undecidable")
        if ticket.get("work_type") not in ("feature", "bug", "maintenance"):
            reasons.append("work type unresolved")
        if ticket.get("work_type") == "bug" and ticket.get("bug_evidence") not in ("reproduced", "independent"):
            reasons.append("bug not reproduced/identified")
        if ticket.get("acceptance_executable") is not True:
            reasons.append("acceptance not executable")
        if not filled(ticket.get("dependency_owner")):
            reasons.append("dependency owner missing")
        if not filled(ticket.get("validation_path")):
            reasons.append("validation path missing")
        if critical and status != "admitted":
            fail(f"{name}: critical path not admitted")
        if (critical or status == "admitted") and reasons:
            fail(f"{name}: not admissible: {', '.join(reasons)}")
    print("PASS")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "--check":
        fail("usage: grade.py --check candidate.json")
    grade(sys.argv[2])
