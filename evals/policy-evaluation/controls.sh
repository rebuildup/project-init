#!/usr/bin/env bash
set -uo pipefail

R=$(cd "$(dirname "$0")/../.." && pwd)
RC=0

expect() {
  label=$1
  file=$2
  expected=$3

  out=$(bash "$R/evals/policy-evaluation/grade.sh" "$file" 2>&1)
  got=$(echo "$out" | tail -1)

  if [ "$got" = "EVAL $expected" ]; then
    printf '  ok   %-34s -> %s\n' "$label" "$got"
  else
    printf '  FAIL %-34s -> %s (wanted EVAL %s)\n' "$label" "$got" "$expected"
    echo "$out" | grep -E 'MISS|VIOL' | sed 's/^/         /'
    RC=1
  fi
}

expect "negative control"   "$R/evals/policy-evaluation/fixtures/negative.txt" FAIL
expect "regression control"   "$R/evals/policy-evaluation/fixtures/regression.txt" FAIL
expect "positive control"   "$R/evals/policy-evaluation/fixtures/positive.txt" PASS

if [ "$RC" -eq 0 ]; then
  echo "controls OK: grader discriminates"
else
  echo "CONTROLS BROKEN: eval scores are not trustworthy"
fi

exit "$RC"
