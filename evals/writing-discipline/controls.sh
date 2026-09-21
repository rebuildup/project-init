#!/usr/bin/env bash
set -uo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)
RC=0

expect() {
  label=$1
  file=$2
  expected=$3

  out=$(bash "$R/evals/writing-discipline/grade.sh" "$file" 2>&1)
  rc=$?
  got=$(echo "$out" | tail -1)

  if { [ "$expected" = "PASS" ] && [ "$rc" -eq 0 ] && [ "$got" = "EVAL PASS" ]; } ||
     { [ "$expected" = "FAIL" ] && [ "$rc" -ne 0 ] && [ "$got" = "EVAL FAIL" ]; }; then
    printf '  ok   %-34s -> %s\n' "$label" "$got"
  else
    printf '  FAIL %-34s -> %s (wanted EVAL %s, rc=%s)\n' "$label" "$got" "$expected" "$rc"
    echo "$out" | grep -E 'MISS|VIOL|INVALID' | sed 's/^/         /'
    RC=1
  fi
}

expect "negative control" "$R/evals/writing-discipline/fixtures/negative.md" FAIL
expect "regression control" "$R/evals/writing-discipline/fixtures/regression.md" FAIL
expect "positive control" "$R/evals/writing-discipline/fixtures/positive.md" PASS

if [ "$RC" -eq 0 ]; then
  echo "controls OK: grader discriminates"
else
  echo "CONTROLS BROKEN: eval scores are not trustworthy"
fi

exit "$RC"
