#!/usr/bin/env bash
set -uo pipefail
R=$(cd "$(dirname "$0")/../.." && pwd)
RC=0

expect() {
  local label=$1 expected=$2
  local file="$R/evals/release-batching/fixtures/$label.json"
  local output status verdict
  output=$(python3 "$R/evals/release-batching/grade.py" "$file" 2>&1)
  status=$?
  verdict=$(printf '%s\n' "$output" | tail -n 1)
  if { [ "$expected" = PASS ] && [ "$status" -eq 0 ] && [ "$verdict" = "EVAL PASS" ]; } ||
     { [ "$expected" = FAIL ] && [ "$status" -ne 0 ] && [ "$verdict" = "EVAL FAIL" ]; }; then
    printf '  ok  %-34s -> %s\n' "$label" "$verdict"
  else
    printf '  FAIL %-34s -> %s (exit %s; expected %s)\n' "$label" "$verdict" "$status" "$expected"
    printf '%s\n' "$output"
    RC=1
  fi
}

expect positive-weekly-hold PASS
expect positive-frozen-candidate PASS
expect positive-authorized-release PASS
expect positive-blocked-unknown PASS
expect negative-weekly-auto-merge FAIL
expect negative-counts-only FAIL
expect negative-mutable-ref FAIL
expect negative-stale-validation FAIL
expect negative-freeze-ticket-landing FAIL
expect negative-unadmitted-candidate FAIL
expect negative-unapproved-release FAIL

require() {
  if ! grep -Fq -- "$2" "$R/$1"; then
    echo "  FAIL contract: $1 missing $2"
    RC=1
  fi
}
require organization/profiles/release-driven-solo.md 'planning / review cadence: 1 week'
require organization/profiles/release-driven-solo.md 'release candidate freeze'
require skills/github-delivery/SKILL.md '## Weekly planning / adaptive release batching'
require skills/github-delivery/SKILL.md 'references/adaptive-release-batching.md'
require skills/github-delivery/references/adaptive-release-batching.md 'hold | candidate | blocked'
require skills/linear-release-control/SKILL.md 'release cadenceは可変'
require docs/adr/ADR-0032.md 'user authorization'

if [ "$RC" -eq 0 ]; then
  echo "release-batching controls OK"
else
  echo "release-batching CONTROLS BROKEN"
fi
exit "$RC"
