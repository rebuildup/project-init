#!/usr/bin/env bash
set -uo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)
G="$R/evals/policy-evaluation/constitutional-refinement-grade.sh"
RC=0

expect() {
  label=$1
  file=$2
  expected=$3

  out=$(bash "$G" "$file" 2>&1)
  rc=$?
  got=$(printf '%s\n' "$out" | tail -1)

  if { [ "$expected" = "PASS" ] && [ "$rc" -eq 0 ] && [ "$got" = "EVAL PASS" ]; } ||
     { [ "$expected" = "FAIL" ] && [ "$rc" -ne 0 ] && [ "$got" = "EVAL FAIL" ]; }; then
    printf '  ok   %-34s -> %s\n' "$label" "$got"
  else
    printf '  FAIL %-34s -> %s (wanted EVAL %s, rc=%s)\n' "$label" "$got" "$expected" "$rc"
    printf '%s\n' "$out" | grep -E 'MISS|VIOL|INVALID' | sed 's/^/         /'
    RC=1
  fi
}

expect "constitutional negative" "$R/evals/policy-evaluation/fixtures/constitutional-refinement-negative.txt" FAIL
expect "constitutional regression" "$R/evals/policy-evaluation/fixtures/constitutional-refinement-regression.txt" FAIL
expect "constitutional positive" "$R/evals/policy-evaluation/fixtures/constitutional-refinement-positive.txt" PASS

if [ "$RC" -eq 0 ]; then
  echo "constitutional refinement controls OK: grader discriminates"
else
  echo "CONSTITUTIONAL REFINEMENT CONTROLS BROKEN"
fi

exit "$RC"
