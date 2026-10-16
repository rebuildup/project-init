#!/usr/bin/env bash
set -uo pipefail
D=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
rc=0

# Each case is generated from the same positive candidate. The grader is an
# independent process; a negative must exit nonzero with an explicit FAIL.
expect() {
  case_name=$1
  want=$2
  python3 - "$tmp/candidate.json" "$case_name" <<'PY'
import json
import sys
candidate = {
    "release": "0.5.0",
    "calendar_target": "2026-10-17",
    "work_graph_stable": True,
    "terminal_validated": False,
    "release_ready": False,
    "tickets": [{
        "id": "#54",
        "critical_path": True,
        "admission": "admitted",
        "work_type": "feature",
        "requirements": "decidable",
        "bug_evidence": None,
        "acceptance_executable": True,
        "dependency_owner": "release-owner",
        "validation_path": "bash evals/release-scope-admission/controls.sh",
    }],
}
case = sys.argv[2]
ticket = candidate["tickets"][0]
if case == "undecidable": ticket["requirements"] = "unknown"
if case == "unreproduced-bug":
    ticket["work_type"] = "bug"
    ticket["bug_evidence"] = "unknown"
if case == "no-acceptance": ticket["acceptance_executable"] = False
if case == "unowned": ticket["dependency_owner"] = ""
if case == "no-validation": ticket["validation_path"] = ""
if case == "structural-unknown": candidate["work_graph_stable"] = False
if case == "calendar-only": ticket["requirements"] = "unknown"
if case == "terminal-only":
    ticket["requirements"] = "unknown"
    candidate["terminal_validated"] = True
    candidate["release_ready"] = True
if case == "premature-release": candidate["release_ready"] = True
if case == "discovery-not-critical":
    ticket["critical_path"] = False
    ticket["admission"] = "discovery"
    ticket["requirements"] = "unknown"
with open(sys.argv[1], "w", encoding="utf-8") as out:
    json.dump(candidate, out)
PY
  out=$(python3 "$D/grade.py" --check "$tmp/candidate.json" 2>&1)
  got=$?
  marker=$(printf '%s\n' "$out" | tail -n 1)
  if [ "$want" = PASS ]; then
    if [ "$got" -eq 0 ] && [ "$marker" = PASS ]; then
      echo "  ok   $case_name -> PASS"
    else
      echo "  FAIL $case_name -> $marker (rc=$got)"
      rc=1
    fi
  else
    case "$marker" in
      FAIL\ *) if [ "$got" -ne 0 ]; then echo "  ok   $case_name -> $marker"; else rc=1; fi ;;
      *) echo "  FAIL $case_name -> $marker (rc=$got)"; rc=1 ;;
    esac
  fi
}
expect good PASS
expect discovery-not-critical PASS
expect undecidable FAIL
expect unreproduced-bug FAIL
expect no-acceptance FAIL
expect unowned FAIL
expect no-validation FAIL
expect structural-unknown FAIL
expect calendar-only FAIL
expect terminal-only FAIL
expect premature-release FAIL
if [ "$rc" -eq 0 ]; then
  echo "controls OK: admission and terminal readiness discriminated"
else
  echo "CONTROLS BROKEN: admission detection failed"
fi
exit "$rc"
