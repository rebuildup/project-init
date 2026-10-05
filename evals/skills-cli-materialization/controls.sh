#!/usr/bin/env bash
# Control runner for the Skills CLI materialization eval.
#
# The grader is a script, so its controls are fixture trees rather than
# answer files: each fixture is a materialized project that must be accepted
# or rejected for a specific, named reason. A grader that cannot reject the
# negative and regression fixtures is not trustworthy as quality evidence,
# which is the same rule CONTRIBUTING states for latent graders.
#
#   bash controls.sh
#
# Exits non-zero if any control does not get the expected verdict.
set -uo pipefail

D=$(cd "$(dirname "$0")" && pwd)
RC=0

expect() {
  label=$1
  fixture=$2
  expected=$3

  out=$(bash "$D/grade.sh" --check "$fixture" 2>&1)
  rc=$?
  got=$(printf '%s\n' "$out" | tail -n 1)

  verdict_ok() {
    case "$got" in
      PASS|FAIL|FAIL\ *) return 0 ;;
      *) return 1 ;;
    esac
  }

  if [ "$expected" = "PASS" ]; then
    if [ "$rc" -eq 0 ] && [ "$got" = "PASS" ]; then
      printf '  ok   %-46s -> %s\n' "$label" "$got"
    else
      printf '  FAIL %-46s -> rc=%s last=%s (wanted PASS)\n' "$label" "$rc" "$got"
      printf '%s\n' "$out" | sed 's/^/         /'
      RC=1
    fi
  else
    if [ "$rc" -ne 0 ] && verdict_ok && [ "$got" != "PASS" ]; then
      printf '  ok   %-46s -> %s\n' "$label" "${got:0:70}"
    else
      printf '  FAIL %-46s -> rc=%s last=%s (wanted FAIL with FAIL marker)\n' "$label" "$rc" "$got"
      printf '%s\n' "$out" | sed 's/^/         /'
      RC=1
    fi
  fi
}

# positive: a well-formed materialization.
expect "positive: valid project-local materialization" "$D/fixtures/positive" PASS

# negative controls, one broken property each.

expect "negative: frontmatter name mismatch" \
  "$D/fixtures/negative-name-mismatch" FAIL

expect "negative: unquoted description with colon-space" \
  "$D/fixtures/negative-unquoted-colon" FAIL

expect "negative: missing computedHash in lock" \
  "$D/fixtures/negative-lock-no-hash" FAIL

expect "negative: SKILL.md listed as Skipped by the CLI" \
  "$D/fixtures/negative-skipped-in-list" FAIL

expect "negative: agent link directory not gitignored" \
  "$D/fixtures/negative-untracked-agent-link" FAIL

expect "negative: referenced references/ file missing" \
  "$D/fixtures/negative-missing-reference" FAIL

# regression control: the exact shape that shipped broken in xyt-media --
# four skills whose descriptions the Skills CLI refused to parse.
expect "regression: xyt-media unquoted-Triggers shape" \
  "$D/fixtures/regression-unquoted-triggers" FAIL

if [ "$RC" -eq 0 ]; then
  echo "controls OK: grader discriminates"
else
  echo "CONTROLS BROKEN: eval scores are not trustworthy"
fi

exit "$RC"