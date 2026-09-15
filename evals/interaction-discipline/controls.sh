#!/usr/bin/env bash
set -uo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)
RC=0

expect() {
  label=$1
  file=$2
  expected=$3

  out=$(bash "$R/evals/interaction-discipline/grade.sh" "$file" 2>&1)
  rc=$?
  got=$(echo "$out" | tail -1)

  # The grader's exit code is part of its verdict: PASS exits 0, FAIL exits 1.
  # Without this check the harness would still accept a broken grader that
  # emits "EVAL PASS" while exiting non-zero (or vice versa).
  if { [ "$expected" = "PASS" ] && [ "$rc" -eq 0 ] && [ "$got" = "EVAL PASS" ]; } ||
     { [ "$expected" = "FAIL" ] && [ "$rc" -ne 0 ] && [ "$got" = "EVAL FAIL" ]; }; then
    printf '  ok   %-34s -> %s\n' "$label" "$got"
  else
    printf '  FAIL %-34s -> %s (wanted EVAL %s, rc=%s)\n' "$label" "$got" "$expected" "$rc"
    echo "$out" | grep -E 'MISS|VIOL|INVALID|DUPLICATE' | sed 's/^/         /'
    RC=1
  fi
}

expect "negative control" "$R/evals/interaction-discipline/fixtures/negative.txt" FAIL
expect "regression control" "$R/evals/interaction-discipline/fixtures/regression.txt" FAIL
expect "positive control" "$R/evals/interaction-discipline/fixtures/positive.txt" PASS

if [ "$RC" -eq 0 ]; then
  echo "controls OK: grader discriminates"
else
  echo "CONTROLS BROKEN: eval scores are not trustworthy"
fi

exit "$RC"
