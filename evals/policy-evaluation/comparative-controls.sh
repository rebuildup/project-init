#!/usr/bin/env bash
set -uo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)
RC=0

expect() {
  label=$1
  file=$2
  expected=$3

  out=$(bash "$R/evals/policy-evaluation/comparative-grade.sh" "$file" 2>&1)
  got=$(echo "$out" | tail -1)

  if [ "$got" = "EVAL $expected" ]; then
    printf '  ok   %-34s -> %s\n' "$label" "$got"
  else
    printf '  FAIL %-34s -> %s (wanted EVAL %s)\n' "$label" "$got" "$expected"
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
