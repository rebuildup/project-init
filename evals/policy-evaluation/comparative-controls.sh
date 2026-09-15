#!/usr/bin/env bash
set -uo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)
RC=0

expect() {
  label=$1
  file=$2
  expected=$3

  out=$(bash "$R/evals/policy-evaluation/comparative-grade.sh" "$file" 2>&1)
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

expect "comparative negative control" "$R/evals/policy-evaluation/fixtures/comparative-negative.txt" FAIL
expect "comparative regression control" "$R/evals/policy-evaluation/fixtures/comparative-regression.txt" FAIL
expect "comparative positive control" "$R/evals/policy-evaluation/fixtures/comparative-positive.txt" PASS

if [ "$RC" -eq 0 ]; then
  echo "comparative controls OK: grader discriminates"
else
  echo "COMPARATIVE CONTROLS BROKEN: eval scores are not trustworthy"
fi

exit "$RC"
